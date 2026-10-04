package uk.co.wrekinlabs.senseveil

import android.os.SystemClock
import java.io.BufferedInputStream
import java.io.IOException
import java.io.InputStream
import java.net.Inet6Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket
import java.net.SocketTimeoutException
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction
import java.security.SecureRandom
import kotlin.math.abs
import kotlin.math.min

/** Snapshot taken once per connection so a mid-stream settings edit cannot split one session. */
data class RfBridgeConfig(
    val host: String,
    val port: Int,
    val pairCode: String,
    val allowNonLocalHost: Boolean = false,
    val v2Key: ByteArray? = null,
    val requireV2: Boolean = false
)

/**
 * Android-free RF bridge client so the threading can be unit-tested against a local ServerSocket.
 *
 * Guarantees:
 *  - at most one live generation; every callback and every analyzer mutation is checked against
 *    the current generation under [lock], so no reading is delivered after stop() emitted OFF;
 *  - stop() closes the active socket, unblocking connect()/read() immediately (Thread.interrupt
 *    does not unblock java.net socket I/O);
 *  - bounded line length, bounded discard, exponential backoff with jitter, permission pre-check
 *    (Android 17 local-network denial surfaces as a connect TIMEOUT, not a SecurityException).
 */
class RfBridgeClient(
    private val config: () -> RfBridgeConfig,
    private val hasPermission: () -> Boolean,
    private val onReading: (WifiRfReading) -> Unit,
    private val elapsed: () -> Long = { SystemClock.elapsedRealtime() },
    private val resolver: (String) -> Array<InetAddress> = { InetAddress.getAllByName(it) },
    private val timing: Timing = Timing()
) {
    data class Timing(
        val connectTimeoutMs: Int = 2_500,
        val readTimeoutMs: Int = 1_000,
        val initialBackoffMs: Long = 1_500L,
        val maxBackoffMs: Long = 30_000L,
        val permissionRetryMs: Long = 5_000L,
        val staleEmitIntervalMs: Long = 1_000L
    )

    private val lock = Any()
    private val analyzer = WifiRfAnalyzer()
    private val random = SecureRandom()
    private var generation = 0L          // guarded by lock
    private var running = false          // guarded by lock
    private var worker: Thread? = null   // guarded by lock
    private var activeSocket: Socket? = null // guarded by lock
    private var deviceMoving = false     // guarded by lock

    fun start() {
        synchronized(lock) {
            if (running) return
            running = true
            val gen = ++generation
            onReading(WifiRfReading(status = WifiRfStatus.CONNECTING, message = "connecting to paired RF bridge"))
            worker = Thread({ loop(gen) }, "SenseVeil-RF-$gen").apply { isDaemon = true; start() }
        }
    }

    fun stop() {
        val socket: Socket?
        val thread: Thread?
        synchronized(lock) {
            running = false
            generation++
            socket = activeSocket
            activeSocket = null
            thread = worker
            worker = null
            onReading(WifiRfReading(status = WifiRfStatus.OFF, message = "RF bridge off"))
        }
        closeQuietly(socket)
        thread?.interrupt()
    }

    fun setDeviceMoving(value: Boolean) {
        synchronized(lock) {
            if (value && !deviceMoving) analyzer.invalidateBaseline()
            deviceMoving = value
        }
    }

    fun resetBaseline() {
        synchronized(lock) {
            analyzer.reset()
            if (running) onReading(WifiRfReading(status = WifiRfStatus.CALIBRATING, message = "RF baseline reset; hold phone still"))
        }
    }

    /** Test hook: true while a worker thread for the current generation exists. */
    internal fun isRunning() = synchronized(lock) { running }

    private fun isCurrent(gen: Long) = synchronized(lock) { running && generation == gen }

    private inline fun ifCurrent(gen: Long, block: () -> Unit): Boolean = synchronized(lock) {
        if (!running || generation != gen) return false
        block()
        true
    }

    private fun loop(gen: Long) {
        var backoff = timing.initialBackoffMs
        while (isCurrent(gen)) {
            if (!hasPermission()) {
                ifCurrent(gen) { onReading(WifiRfReading(status = WifiRfStatus.UNAVAILABLE, message = "local network permission required")) }
                sleep(timing.permissionRetryMs)
                continue
            }
            val cfg = config()
            var validFrames = 0
            val failure: String? = try {
                validFrames = session(gen, cfg)
                if (validFrames > 0) "RF bridge disconnected" else "RF bridge closed the connection without valid frames"
            } catch (e: HostPolicyException) {
                e.message
            } catch (e: SocketTimeoutException) {
                "RF bridge did not answer (check host/port, same Wi-Fi network, bridge powered)"
            } catch (e: IOException) {
                "RF bridge unavailable: " + e.javaClass.simpleName
            } catch (e: SecurityException) {
                "local network permission required"
            }
            if (!isCurrent(gen)) break
            if (validFrames > 0) backoff = timing.initialBackoffMs
            ifCurrent(gen) { onReading(WifiRfReading(status = WifiRfStatus.UNAVAILABLE, message = failure ?: "RF bridge unavailable")) }
            sleep(jitter(backoff))
            backoff = min(backoff * 2, timing.maxBackoffMs)
        }
    }

    /** Returns the number of valid frames received in this connection. */
    private fun session(gen: Long, cfg: RfBridgeConfig): Int {
        val address = resolveAllowed(cfg)
        val socket = Socket()
        if (!ifCurrent(gen) { activeSocket = socket }) { closeQuietly(socket); return 0 }
        var valid = 0
        try {
            socket.connect(InetSocketAddress(address, cfg.port), timing.connectTimeoutMs)
            socket.soTimeout = timing.readTimeoutMs
            socket.tcpNoDelay = true
            val nonce = randomHex(16)
            if (!ifCurrent(gen) {
                    analyzer.reset() // new connection = new baseline
                    onReading(WifiRfReading(status = WifiRfStatus.CALIBRATING, message = "RF bridge connected; recalibrating baseline"))
                }) return 0
            socket.getOutputStream().apply {
                write((WifiRfProtocol.hello(cfg.pairCode, nonce) + "\n").toByteArray(Charsets.UTF_8))
                flush()
            }
            val reader = BoundedLineReader(BufferedInputStream(socket.getInputStream()), WifiRfProtocol.MAX_FRAME_BYTES)
            val rejects = LinkedHashMap<String, Int>()
            val connectedAt = elapsed()
            var lastStatusEmit = 0L
            // Called after every line AND on read timeouts, so a bridge that streams only junk
            // (e.g. wrong pair code) still produces a diagnosable status instead of CALIBRATING forever.
            fun checkHealth() {
                val now = elapsed()
                if (now - lastStatusEmit < timing.staleEmitIntervalMs) return
                ifCurrent(gen) {
                    val stale = analyzer.stale(now)
                    when {
                        stale != null -> {
                            lastStatusEmit = now
                            onReading(if (rejects.isEmpty()) stale else stale.copy(message = stale.message + "; rejected: " + summary(rejects)))
                        }
                        valid == 0 && now - connectedAt > WifiRfAnalyzer.STALE_MS -> {
                            lastStatusEmit = now
                            onReading(WifiRfReading(status = WifiRfStatus.UNAVAILABLE, message =
                                if (rejects.isEmpty()) "connected, but no RF frames received" else "no valid RF frames; rejected: " + summary(rejects)))
                        }
                    }
                }
            }
            while (isCurrent(gen)) {
                val line = try {
                    reader.readLine()
                } catch (_: SocketTimeoutException) {
                    checkHealth(); continue
                } ?: return valid
                when (line) {
                    is BoundedLineReader.Line.Oversized -> rejects.merge("oversized frame", 1, Int::plus)
                    is BoundedLineReader.Line.InvalidUtf8 -> rejects.merge("invalid UTF-8", 1, Int::plus)
                    is BoundedLineReader.Line.Text -> when (val parsed = WifiRfProtocol.parseDetailed(
                        line.value, cfg.pairCode, elapsed(), cfg.v2Key, nonce, cfg.requireV2)) {
                        is RfParse.Accepted -> {
                            if (!ifCurrent(gen) { onReading(analyzer.accept(parsed.frame, deviceMoving)) }) return valid
                            valid++
                        }
                        is RfParse.Rejected -> rejects.merge(parsed.reason, 1, Int::plus)
                    }
                }
                if (rejects.size > 16) rejects.keys.drop(16).forEach { rejects.remove(it) }
                checkHealth()
            }
            return valid
        } finally {
            synchronized(lock) { if (activeSocket === socket) activeSocket = null }
            closeQuietly(socket)
        }
    }

    private fun resolveAllowed(cfg: RfBridgeConfig): InetAddress {
        if (!RfHostPolicy.isSyntacticallyValid(cfg.host)) throw HostPolicyException("RF bridge host is not a valid host name or IP address")
        val addresses = try { resolver(cfg.host) } catch (e: Exception) { throw HostPolicyException("RF bridge host could not be resolved") }
        return addresses.firstOrNull { RfHostPolicy.isLocal(it) }
            ?: addresses.firstOrNull()?.takeIf { cfg.allowNonLocalHost && !it.isAnyLocalAddress && !it.isMulticastAddress }
            ?: throw HostPolicyException("RF bridge host must be on the local network (private, link-local or loopback address)")
    }

    private fun summary(rejects: Map<String, Int>) = rejects.entries.joinToString(", ") { "${it.value}× ${it.key}" }

    private fun jitter(ms: Long): Long = (ms * (0.8 + 0.4 * random.nextDouble())).toLong()

    private fun sleep(ms: Long) = try { Thread.sleep(ms) } catch (_: InterruptedException) { }

    private fun randomHex(bytes: Int) = ByteArray(bytes).also(random::nextBytes).joinToString("") { "%02x".format(it) }

    private fun closeQuietly(socket: Socket?) { try { socket?.close() } catch (_: IOException) { } }

    class HostPolicyException(message: String) : IOException(message)
}

/** SenseVeil talks to a sensor on the same LAN. Anything else needs an explicit advanced override. */
object RfHostPolicy {
    private val HOST = Regex("[A-Za-z0-9.:%_-]{1,253}")

    fun isSyntacticallyValid(host: String) = HOST.matches(host) && !host.startsWith("-")

    fun isLocal(address: InetAddress): Boolean = when {
        address.isAnyLocalAddress || address.isMulticastAddress -> false
        address.isLoopbackAddress || address.isSiteLocalAddress || address.isLinkLocalAddress -> true
        address is Inet6Address -> (address.address[0].toInt() and 0xFE) == 0xFC // IPv6 ULA fc00::/7
        else -> false
    }
}

/**
 * Reads '\n'-terminated lines without ever buffering more than [maxBytes]. Over-long lines are
 * discarded and reported; an endless line beyond [maxDiscardBytes] aborts the connection.
 * State survives SocketTimeoutException, so a frame split across a timeout is not corrupted.
 */
class BoundedLineReader(
    private val input: InputStream,
    private val maxBytes: Int,
    private val maxDiscardBytes: Long = maxBytes * 64L
) {
    sealed class Line {
        data class Text(val value: String) : Line()
        data class Oversized(val bytes: Long) : Line()
        object InvalidUtf8 : Line()
    }

    private val buffer = ByteArray(maxBytes)
    private var length = 0
    private var total = 0L
    private var overflow = false

    /** Null at end of stream. A partial final line without '\n' is dropped. */
    fun readLine(): Line? {
        while (true) {
            val b = input.read()
            if (b < 0) { clear(); return null }
            if (b == '\n'.code) break
            total++
            if (overflow) {
                if (total > maxDiscardBytes) throw IOException("RF frame flood: no newline within $maxDiscardBytes bytes")
                continue
            }
            if (length == maxBytes) { overflow = true; continue }
            buffer[length++] = b.toByte()
        }
        val result: Line = if (overflow) Line.Oversized(total) else decode()
        clear()
        return result
    }

    private fun decode(): Line {
        var end = length
        if (end > 0 && buffer[end - 1] == '\r'.code.toByte()) end--
        return try {
            val decoder = Charsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
            Line.Text(decoder.decode(ByteBuffer.wrap(buffer, 0, end)).toString())
        } catch (_: CharacterCodingException) {
            Line.InvalidUtf8
        }
    }

    private fun clear() { length = 0; total = 0L; overflow = false }
}

/**
 * Operator-motion gate for RF classification. Enters "moving" immediately on a spike, but only
 * returns to "stationary" after [settleMs] of continuous quiet, so hand tremor or a single
 * footstep cannot repeatedly wipe a 30-sample baseline. (Camera detection keeps its own logic.)
 */
class MotionGate(
    private val enterThreshold: Float = 1.8f,
    private val exitThreshold: Float = 1.2f,
    private val settleMs: Long = 1_500L
) {
    var moving = false
        private set
    private var quietSince = -1L

    /** Returns true only when the moving/stationary state changes. */
    @Synchronized
    fun update(accelerationMagnitude: Float?, nowElapsedMs: Long): Boolean {
        if (accelerationMagnitude == null || !accelerationMagnitude.isFinite()) return false
        val deviation = abs(accelerationMagnitude - GRAVITY)
        if (deviation > enterThreshold) {
            quietSince = -1L
            if (!moving) { moving = true; return true }
            return false
        }
        if (!moving) return false
        if (deviation < exitThreshold) {
            if (quietSince < 0) quietSince = nowElapsedMs
            if (nowElapsedMs - quietSince >= settleMs) { moving = false; quietSince = -1L; return true }
        } else {
            quietSince = -1L
        }
        return false
    }

    companion object { const val GRAVITY = 9.80665f }
}
