package uk.co.wrekinlabs.senseveil

import android.os.SystemClock
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest
import java.util.ArrayDeque
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

enum class WifiRfStatus { OFF, CONNECTING, CALIBRATING, READY, RF_CHANGE, PAUSED_MOVING, UNAVAILABLE, STALE }

/** How the frame's origin was established. PAIR_CODE_ONLY is NOT authentication. */
enum class RfAuth { PAIR_CODE_ONLY, HMAC_V2 }

data class WifiRfFrame(
    val source: String,
    val sequence: Long,
    val sensorEpochMs: Long,
    val sampleRateHz: Float,
    val rssiDbm: Float?,
    val csiAmplitude: Float?,
    val csiVariance: Float?,
    val receivedElapsedMs: Long,
    val synthetic: Boolean = false,
    val auth: RfAuth = RfAuth.PAIR_CODE_ONLY,
    val receivedEpochMs: Long = System.currentTimeMillis()
)

data class WifiRfReading(
    val status: WifiRfStatus = WifiRfStatus.OFF,
    val source: String? = null,
    val novelty: Float = 0f,
    val sustainedChange: Boolean = false,
    val baselineSamples: Int = 0,
    val sampleRateHz: Float? = null,
    val rssiDbm: Float? = null,
    val csiAmplitude: Float? = null,
    val csiVariance: Float? = null,
    val message: String = "RF sensing off",
    val epochMs: Long = System.currentTimeMillis(),
    // RC5 additions (all optional; older evidence simply lacks them)
    val baselineTarget: Int = WifiRfAnalyzer.BASELINE_SAMPLES,
    val measuredRateHz: Float? = null,
    val packetLossPercent: Float? = null,
    val synthetic: Boolean = false,
    val auth: RfAuth? = null,
    val sensorClockSynced: Boolean? = null,
    val algorithm: String = WifiRfAnalyzer.ALGORITHM
)

data class WifiSurveyReading(
    /** Null when the scan could not be trusted (permission, Location off, no hardware). Never report 0 for "unknown". */
    val visibleNetworks: Int? = null,
    val strongestRssiDbm: Int? = null,
    val medianRssiDbm: Int? = null,
    val band24Count: Int = 0,
    val band5Count: Int = 0,
    val band6Count: Int = 0,
    val status: String = "off",
    val epochMs: Long = System.currentTimeMillis(),
    /** Age of the newest scan result used, so cached/throttled results are visible in evidence. */
    val newestResultAgeMs: Long? = null
) {
    val valid: Boolean get() = visibleNetworks != null
}

sealed class RfParse {
    data class Accepted(val frame: WifiRfFrame) : RfParse()
    data class Rejected(val reason: String) : RfParse()
}

object WifiRfProtocol {
    /** Hard upper bound on one newline-delimited frame (bytes). Real frames are ~200 bytes. */
    const val MAX_FRAME_BYTES = 2_048
    /** JSON-safe integer ceiling (2^53 - 1); ESP32 JSON libraries lose precision above this. */
    const val MAX_SAFE_INTEGER = 9_007_199_254_740_991L
    const val V2_PREFIX = "SV2 "
    private const val V2_CONTEXT = "senseveil-rf-v2"
    private val SOURCE = Regex("[A-Za-z0-9][A-Za-z0-9._:-]{0,63}")
    /** 12 hex digits, optionally separated: a MAC/BSSID. Nearby-device identifiers must not enter evidence. */
    private val HARDWARE_ADDRESS = Regex("(?i)(?:^|[^0-9a-f])[0-9a-f]{2}(?:[:.-]?[0-9a-f]{2}){5}(?:$|[^0-9a-f])")

    fun parse(line: String, expectedPairCode: String, nowElapsedMs: Long = SystemClock.elapsedRealtime()): WifiRfFrame? =
        (parseDetailed(line, expectedPairCode, nowElapsedMs) as? RfParse.Accepted)?.frame

    fun parseDetailed(
        line: String,
        expectedPairCode: String,
        nowElapsedMs: Long = SystemClock.elapsedRealtime(),
        v2Key: ByteArray? = null,
        v2Nonce: String? = null,
        requireV2: Boolean = false,
        nowEpochMs: Long = System.currentTimeMillis()
    ): RfParse {
        if (line.length > MAX_FRAME_BYTES) return RfParse.Rejected("oversized frame")
        var auth = RfAuth.PAIR_CODE_ONLY
        val json: String
        if (line.startsWith(V2_PREFIX)) {
            if (v2Key == null || v2Nonce == null) return RfParse.Rejected("v2 frame but no bridge key configured")
            // "SV2 " + 64 hex MAC + " " + JSON
            if (line.length < 4 + 64 + 2 || line[4 + 64] != ' ') return RfParse.Rejected("malformed v2 frame")
            val mac = hexToBytes(line.substring(4, 4 + 64)) ?: return RfParse.Rejected("malformed v2 MAC")
            json = line.substring(4 + 64 + 1)
            if (!MessageDigest.isEqual(mac, v2Mac(v2Key, v2Nonce, json))) return RfParse.Rejected("v2 MAC mismatch")
            auth = RfAuth.HMAC_V2
        } else {
            if (requireV2) return RfParse.Rejected("unauthenticated frame refused (v2 required)")
            json = line
        }
        val j = runCatching { JSONObject(json) }.getOrNull() ?: return RfParse.Rejected("malformed JSON")
        val version = exactLong(j, "v") ?: return RfParse.Rejected("missing protocol version")
        when (auth) {
            RfAuth.HMAC_V2 -> if (version != 2L) return RfParse.Rejected("v2 MAC on non-v2 payload")
            RfAuth.PAIR_CODE_ONLY -> {
                if (version != 1L) return RfParse.Rejected("unsupported protocol version")
                val pair = j.opt("pair") as? String ?: return RfParse.Rejected("missing pair code")
                if (!constantTimeEquals(pair, expectedPairCode)) return RfParse.Rejected("pair code mismatch")
            }
        }
        val source = (j.opt("source") as? String)?.takeIf { SOURCE.matches(it) }
            ?: return RfParse.Rejected("missing or unsafe source")
        if (HARDWARE_ADDRESS.containsMatchIn(source)) return RfParse.Rejected("source looks like a hardware address")
        val seq = exactLong(j, "seq") ?: return RfParse.Rejected("missing or invalid seq")
        val epoch = exactLong(j, "epochMs")?.takeIf { it > 0 } ?: return RfParse.Rejected("missing or invalid epochMs")
        val rate = when (val r = number(j, "sampleRateHz", 0.001f..1_000f)) {
            is Num.Ok -> r.value
            else -> return RfParse.Rejected("missing or invalid sampleRateHz")
        }
        val rssi = when (val r = number(j, "rssiDbm", -140f..20f)) {
            Num.Absent -> null; Num.Invalid -> return RfParse.Rejected("rssiDbm invalid or out of range"); is Num.Ok -> r.value
        }
        val amp = when (val r = number(j, "csiAmplitude", 0f..MAX_CSI_AMPLITUDE)) {
            Num.Absent -> null; Num.Invalid -> return RfParse.Rejected("csiAmplitude invalid or out of range"); is Num.Ok -> r.value
        }
        val variance = when (val r = number(j, "csiVariance", 0f..MAX_CSI_VARIANCE)) {
            Num.Absent -> null; Num.Invalid -> return RfParse.Rejected("csiVariance invalid or out of range"); is Num.Ok -> r.value
        }
        if (rssi == null && amp == null && variance == null) return RfParse.Rejected("no RF measurement in frame")
        val synthetic = j.opt("synthetic") == true || source.startsWith("mock", ignoreCase = true)
        return RfParse.Accepted(WifiRfFrame(source, seq, epoch, rate, rssi, amp, variance, nowElapsedMs, synthetic, auth, nowEpochMs))
    }

    /** MAC = HMAC-SHA256(key, "senseveil-rf-v2\n" + nonce + "\n" + exact JSON bytes). No JSON canonicalisation needed. */
    fun v2Mac(key: ByteArray, nonce: String, json: String): ByteArray {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(key, "HmacSHA256"))
        mac.update("$V2_CONTEXT\n$nonce\n".toByteArray(Charsets.UTF_8))
        return mac.doFinal(json.toByteArray(Charsets.UTF_8))
    }

    fun hello(pairCode: String, nonce: String): String =
        JSONObject().put("type", "senseveil_hello").put("v", 1).put("pair", pairCode)
            .put("nonce", nonce).put("maxV", 2).toString()

    private sealed class Num { object Absent : Num(); object Invalid : Num(); data class Ok(val value: Float) : Num() }

    /** Numbers only (no numeric strings), finite AFTER Float conversion (1e300 -> Infinity is rejected). */
    private fun number(j: JSONObject, name: String, range: ClosedFloatingPointRange<Float>): Num {
        if (!j.has(name) || j.isNull(name)) return Num.Absent
        val raw = j.opt(name) as? Number ?: return Num.Invalid
        val f = raw.toDouble().toFloat()
        return if (f.isFinite() && f in range) Num.Ok(f) else Num.Invalid
    }

    /**
     * Integer-valued JSON number in 0..2^53-1. Rejects strings, booleans, fractions and huge values.
     * Works for Android org.json (Int/Long/Double) and the JVM json.org artifact (BigInteger/BigDecimal).
     */
    private fun exactLong(j: JSONObject, name: String): Long? {
        val raw = j.opt(name) as? Number ?: return null
        val decimal = runCatching { java.math.BigDecimal(raw.toString()) }.getOrNull() ?: return null // NaN/Infinity
        if (decimal.signum() < 0 || decimal > java.math.BigDecimal.valueOf(MAX_SAFE_INTEGER)) return null
        return runCatching { decimal.longValueExact() }.getOrNull() // throws for 1.5
    }

    private fun constantTimeEquals(a: String, b: String) =
        MessageDigest.isEqual(a.toByteArray(Charsets.UTF_8), b.toByteArray(Charsets.UTF_8))

    private fun hexToBytes(hex: String): ByteArray? {
        if (hex.length % 2 != 0) return null
        return ByteArray(hex.length / 2) { i ->
            val hi = Character.digit(hex[i * 2], 16); val lo = Character.digit(hex[i * 2 + 1], 16)
            if (hi < 0 || lo < 0) return null
            ((hi shl 4) or lo).toByte()
        }
    }

    const val MAX_CSI_AMPLITUDE = 1.0e6f
    const val MAX_CSI_VARIANCE = 1.0e9f
}

/**
 * Robust, conservative RF change classifier.
 *
 * Baseline: per-channel median + MAD over the first [BASELINE_SAMPLES] stationary frames, with
 * per-channel noise floors so a quantised (MAD = 0) channel cannot make tiny changes look huge.
 * Classification: robust z-score; a positive frame needs z >= [Z_ON] and, when 2+ channels exist,
 * a second channel at >= [Z_SUPPORT] (corroboration). Entry needs [MIN_POSITIVE_FRAMES] over
 * [MIN_POSITIVE_MS] of SENSOR time (immune to TCP bursts); exit needs [EXIT_QUIET_FRAMES] below
 * [Z_OFF] (hysteresis). A change persisting [REBASELINE_AFTER_MS] re-baselines instead of latching forever.
 * Novelty = clamp(maxZ / Z_FULL, 0, 1), so 0.55 still corresponds to the entry threshold.
 */
class WifiRfAnalyzer {
    private class Channel(private val absFloor: Float, private val relFloor: Float) {
        private val calibration = ArrayList<Float>(BASELINE_SAMPLES)
        var median: Float? = null; private set
        private var calibratedMedian = 0f
        private var calibratedScale = 0f
        var scale = 0f; private set

        fun clear() { calibration.clear(); median = null; scale = 0f }
        fun addCalibration(v: Float?) { if (v != null) calibration.add(v) }
        fun finishCalibration() {
            if (calibration.size < MIN_CHANNEL_SAMPLES) { median = null; calibration.clear(); return }
            val m = medianOf(calibration)
            val mad = medianOf(calibration.map { abs(it - m) })
            median = m; scale = max(1.4826f * mad, floorFor(m))
            calibratedMedian = m; calibratedScale = scale
            calibration.clear()
        }
        fun z(v: Float?): Float? { val m = median ?: return null; return if (v == null) null else abs(v - m) / scale }
        /** Slow tracking while quiet. Returns false if the baseline drifted past the allowed limit. */
        fun adapt(v: Float?): Boolean {
            val m = median ?: return true
            if (v == null) return true
            val next = m + ADAPT_ALPHA * (v - m)
            median = next
            scale = max(scale + ADAPT_ALPHA * (1.4826f * abs(v - m) - scale), floorFor(next))
            return abs(next - calibratedMedian) <= DRIFT_LIMIT_SIGMA * calibratedScale
        }
        private fun floorFor(m: Float) = max(absFloor, abs(m) * relFloor)
    }

    private val rssi = Channel(absFloor = 1.5f, relFloor = 0f)
    private val amplitude = Channel(absFloor = 0.01f, relFloor = 0.05f)
    private val variance = Channel(absFloor = 0.002f, relFloor = 0.25f)
    private val channels = listOf(rssi, amplitude, variance)

    private var source: String? = null
    private var lastSequence = -1L
    private var lastSensorEpoch = -1L
    private var lastReceivedElapsed = 0L
    private var rollbackRun = 0
    private var rollbackLast = -1L
    private var baselineSamples = 0
    private var positiveFrames = 0
    private var positiveSince = 0L
    private var gapFrames = 0
    private var latched = false
    private var latchedSince = 0L
    private var quietRun = 0
    private var maxOffset = Double.NaN
    private val intervals = ArrayDeque<Long>()
    private var lossEwma = 0.0
    private var framesSinceConnect = 0
    private var lastStatus = WifiRfStatus.OFF

    @Synchronized
    fun reset() {
        source = null
        lastSequence = -1L
        lastSensorEpoch = -1L
        lastReceivedElapsed = 0L
        rollbackRun = 0
        rollbackLast = -1L
        intervals.clear()
        lossEwma = 0.0
        framesSinceConnect = 0
        clearBaseline()
    }

    @Synchronized
    fun invalidateBaseline() = clearBaseline()

    @Synchronized
    fun accept(frame: WifiRfFrame, deviceMoving: Boolean): WifiRfReading {
        if (source != null && source != frame.source) reset()
        source = frame.source

        // 1. Ordering. Sequence is the primary replay/order guard. Three consecutive rolled-back
        // frames that increase among themselves mean the bridge restarted its counter.
        if (frame.sequence <= lastSequence) {
            rollbackRun = if (rollbackRun > 0 && frame.sequence > rollbackLast) rollbackRun + 1 else 1
            rollbackLast = frame.sequence
            if (rollbackRun < RESTART_CONFIRM_FRAMES) return unavailable(frame, "out-of-order or replayed RF frame rejected")
            reset()
            source = frame.source
        } else {
            rollbackRun = 0
        }
        val gap = if (lastSequence >= 0) frame.sequence - lastSequence - 1 else 0L
        lastSequence = frame.sequence

        // 2. Link quality (measured, not declared).
        if (lastReceivedElapsed > 0L) {
            // Median of recent inter-arrival times: one Wi-Fi stall must not blank classification.
            intervals.addLast((frame.receivedElapsedMs - lastReceivedElapsed).coerceAtLeast(0L))
            while (intervals.size > RATE_WINDOW) intervals.removeFirst()
        }
        val lostFraction = if (gap > 0) min(gap.toDouble(), 1_000.0) / (min(gap.toDouble(), 1_000.0) + 1.0) else 0.0
        lossEwma += 0.05 * (lostFraction - lossEwma)
        lastReceivedElapsed = frame.receivedElapsedMs
        framesSinceConnect++

        // 3. Sensor clock. A reset/jump invalidates the baseline; skew vs phone is recorded, never required.
        var note: String? = null
        if (lastSensorEpoch >= 0) {
            val dt = frame.sensorEpochMs - lastSensorEpoch
            if (dt < -CLOCK_BACKWARD_TOLERANCE_MS || dt > CLOCK_JUMP_MS) {
                lastSensorEpoch = frame.sensorEpochMs
                clearBaseline()
                note = "sensor clock jumped or long gap; RF baseline reset"
            } else if (!maxOffset.isNaN()) {
                maxOffset -= max(0L, dt) * CLOCK_DRIFT_ALLOWANCE // tolerate slow sensor-clock drift
            }
        }
        lastSensorEpoch = max(lastSensorEpoch, frame.sensorEpochMs)
        // offset = sensor clock minus phone monotonic clock. The largest offset seen is the least-delayed
        // frame; how far a frame falls below it is its extra transit delay. No clock sync required.
        val offset = (frame.sensorEpochMs - frame.receivedElapsedMs).toDouble()
        maxOffset = if (maxOffset.isNaN()) offset else max(maxOffset, offset)
        val transitLagMs = maxOffset - offset

        if (frame.sampleRateHz < MIN_RATE_HZ) { clearPositive(); return unavailable(frame, "CSI/RF sample rate too low") }
        val measured = measuredRate()
        if (framesSinceConnect >= RATE_WARMUP_FRAMES && measured != null && measured < MIN_RATE_HZ) {
            clearPositive(); return unavailable(frame, "effective RF frame rate too low (%.1f Hz)".format(measured))
        }
        if (deviceMoving) {
            clearBaseline()
            return reading(frame, WifiRfStatus.PAUSED_MOVING, 0f, "paused while phone is moving; RF baseline invalidated")
        }

        // 4. Calibration.
        if (baselineSamples < BASELINE_SAMPLES) {
            rssi.addCalibration(frame.rssiDbm)
            amplitude.addCalibration(frame.csiAmplitude)
            variance.addCalibration(frame.csiVariance)
            baselineSamples++
            if (baselineSamples == BASELINE_SAMPLES) {
                channels.forEach { it.finishCalibration() }
                if (channels.all { it.median == null }) {
                    clearBaseline()
                    return unavailable(frame, "no RF channel was present consistently during calibration")
                }
            }
            return reading(frame, WifiRfStatus.CALIBRATING, 0f,
                (note?.let { "$it; " } ?: "") + "calibrating stationary RF baseline $baselineSamples/$BASELINE_SAMPLES")
        }

        // 5. Classification.
        val zs = listOf(rssi.z(frame.rssiDbm), amplitude.z(frame.csiAmplitude), variance.z(frame.csiVariance))
            .filterNotNull().sortedDescending()
        if (zs.isEmpty()) return reading(frame, currentStatus(), 0f, "frame lacks calibrated RF channels")
        val maxZ = zs[0]
        val novelty = (maxZ / Z_FULL).coerceIn(0f, 1f)
        val corroborated = zs.size < 2 || zs[1] >= Z_SUPPORT
        val late = transitLagMs > MAX_TRANSIT_LAG_MS
        val lossy = lossEwma > MAX_LOSS_FRACTION
        val t = frame.sensorEpochMs

        if (late || lossy) {
            // Delayed or lossy data may be shown, but never starts or extends a change episode.
            return reading(frame, currentStatus(), novelty,
                if (late) "delayed RF frame excluded from classification" else "RF packet loss high; classification held")
        }

        if (!latched) {
            when {
                maxZ >= Z_ON && corroborated -> {
                    if (positiveFrames == 0) positiveSince = t
                    positiveFrames++
                    gapFrames = 0
                }
                maxZ < Z_OFF -> clearPositive()
                else -> if (++gapFrames > MAX_GAP_FRAMES) clearPositive()
            }
            if (positiveFrames >= MIN_POSITIVE_FRAMES && t - positiveSince >= MIN_POSITIVE_MS) {
                latched = true; latchedSince = t; quietRun = 0
            }
        } else {
            quietRun = if (maxZ < Z_OFF) quietRun + 1 else 0
            if (quietRun >= EXIT_QUIET_FRAMES) {
                latched = false
                clearPositive()
            } else if (t - latchedSince >= REBASELINE_AFTER_MS) {
                clearBaseline()
                return reading(frame, WifiRfStatus.CALIBRATING, novelty,
                    "RF change persisted ${REBASELINE_AFTER_MS / 1000}s; re-baselining to the new environment")
            }
        }

        if (!latched && positiveFrames == 0 && maxZ < Z_QUIET) {
            val withinDrift = rssi.adapt(frame.rssiDbm) and amplitude.adapt(frame.csiAmplitude) and variance.adapt(frame.csiVariance)
            if (!withinDrift) {
                clearBaseline()
                return reading(frame, WifiRfStatus.CALIBRATING, novelty, "RF baseline drifted beyond limit; recalibrating")
            }
        }
        return reading(frame, currentStatus(), novelty,
            if (latched) "sustained RF change from stationary baseline (environmental; not a person detection)" else "RF baseline stable")
    }

    @Synchronized
    fun stale(nowElapsedMs: Long = SystemClock.elapsedRealtime()): WifiRfReading? {
        if (lastReceivedElapsed == 0L || nowElapsedMs - lastReceivedElapsed <= STALE_MS) return null
        clearPositive()
        latched = false
        if (nowElapsedMs - lastReceivedElapsed > STALE_REBASELINE_MS && baselineSamples > 0) clearBaseline()
        lastStatus = WifiRfStatus.STALE
        return WifiRfReading(
            status = WifiRfStatus.STALE,
            source = source,
            baselineSamples = baselineSamples,
            message = "RF bridge data is stale",
            measuredRateHz = null
        )
    }

    private fun currentStatus() = if (latched) WifiRfStatus.RF_CHANGE else WifiRfStatus.READY

    private fun measuredRate(): Float? {
        if (intervals.size < 3) return null
        val median = intervals.sorted()[intervals.size / 2]
        return if (median <= 0L) null else 1000f / median
    }

    private fun reading(frame: WifiRfFrame, status: WifiRfStatus, novelty: Float, message: String): WifiRfReading {
        lastStatus = status
        return WifiRfReading(
            status = status,
            source = frame.source,
            novelty = novelty,
            sustainedChange = status == WifiRfStatus.RF_CHANGE,
            baselineSamples = baselineSamples,
            sampleRateHz = frame.sampleRateHz,
            rssiDbm = frame.rssiDbm,
            csiAmplitude = frame.csiAmplitude,
            csiVariance = frame.csiVariance,
            message = message,
            measuredRateHz = measuredRate(),
            packetLossPercent = (lossEwma * 100.0).toFloat(),
            synthetic = frame.synthetic,
            auth = frame.auth,
            sensorClockSynced = abs(frame.sensorEpochMs - frame.receivedEpochMs) <= CLOCK_SYNC_TOLERANCE_MS
        )
    }

    private fun unavailable(frame: WifiRfFrame, message: String) = reading(frame, WifiRfStatus.UNAVAILABLE, 0f, message)

    private fun clearBaseline() {
        channels.forEach { it.clear() }
        baselineSamples = 0
        maxOffset = Double.NaN
        latched = false
        clearPositive()
    }

    private fun clearPositive() {
        positiveFrames = 0
        positiveSince = 0L
        gapFrames = 0
        quietRun = 0
    }

    companion object {
        const val ALGORITHM = "robust-mad-v2"
        const val BASELINE_SAMPLES = 30
        const val MIN_CHANNEL_SAMPLES = 20
        const val MIN_RATE_HZ = 4f
        const val STALE_MS = 2_500L
        const val STALE_REBASELINE_MS = 10_000L
        const val Z_ON = 5.5f
        const val Z_FULL = 10f
        const val Z_OFF = 3.5f
        const val Z_SUPPORT = 2.5f
        const val Z_QUIET = 2.0f
        const val MIN_POSITIVE_FRAMES = 5
        const val MIN_POSITIVE_MS = 800L
        const val MAX_GAP_FRAMES = 2
        const val EXIT_QUIET_FRAMES = 5
        const val REBASELINE_AFTER_MS = 60_000L
        const val ADAPT_ALPHA = 0.01f
        const val DRIFT_LIMIT_SIGMA = 3f
        const val RESTART_CONFIRM_FRAMES = 3
        const val CLOCK_BACKWARD_TOLERANCE_MS = 500L
        const val CLOCK_JUMP_MS = 10_000L
        const val CLOCK_DRIFT_ALLOWANCE = 0.001
        const val CLOCK_SYNC_TOLERANCE_MS = 5 * 60_000L
        const val MAX_TRANSIT_LAG_MS = 2_000.0
        const val MAX_LOSS_FRACTION = 0.30
        const val RATE_WARMUP_FRAMES = 10
        const val RATE_WINDOW = 9

        internal fun medianOf(values: List<Float>): Float {
            val s = values.sorted()
            val n = s.size
            return if (n % 2 == 1) s[n / 2] else (s[n / 2 - 1] + s[n / 2]) / 2f
        }
    }
}

object WifiSurveyAggregator {
    /** samples = (frequencyMHz, levelDbm). Only aggregate statistics leave this function. */
    fun aggregate(samples: List<Pair<Int, Int>>, epochMs: Long = System.currentTimeMillis(), newestResultAgeMs: Long? = null): WifiSurveyReading {
        if (samples.isEmpty()) return WifiSurveyReading(visibleNetworks = 0, status = "no scan results", epochMs = epochMs, newestResultAgeMs = newestResultAgeMs)
        val rssis = samples.map { it.second }.sorted()
        return WifiSurveyReading(
            visibleNetworks = samples.size,
            strongestRssiDbm = rssis.last(),
            medianRssiDbm = rssis[rssis.size / 2],
            band24Count = samples.count { it.first in 2_400..2_500 },
            band5Count = samples.count { it.first in 4_900..5_900 },
            band6Count = samples.count { it.first in 5_925..7_125 },
            status = "aggregate scan ready",
            epochMs = epochMs,
            newestResultAgeMs = newestResultAgeMs
        )
    }
}

data class TimedRfSample(
    val elapsedMs: Long,
    val epochMs: Long,
    val rf: WifiRfReading? = null,
    val survey: WifiSurveyReading? = null
)

class RfTimeline(private val clock: () -> Long = { SystemClock.elapsedRealtime() }) {
    private val samples = ArrayDeque<TimedRfSample>()

    @Synchronized
    fun addRf(value: WifiRfReading) = add(TimedRfSample(clock(), System.currentTimeMillis(), rf = value))

    @Synchronized
    fun addSurvey(value: WifiSurveyReading) = add(TimedRfSample(clock(), System.currentTimeMillis(), survey = value))

    @Synchronized
    fun window(eventElapsedMs: Long, beforeMs: Long, afterMs: Long): List<TimedRfSample> =
        samples.filter { it.elapsedMs in (eventElapsedMs - beforeMs)..(eventElapsedMs + afterMs) }

    @Synchronized
    private fun add(row: TimedRfSample) {
        samples.addLast(row)
        val cutoff = row.elapsedMs - KEEP_MS
        while (samples.isNotEmpty() && samples.first().elapsedMs < cutoff) samples.removeFirst()
    }

    fun writeCsv(file: File, rows: List<TimedRfSample>) {
        file.parentFile?.mkdirs()
        file.bufferedWriter().use { out ->
            out.appendLine(CSV_HEADER)
            rows.forEach { out.appendLine(csvRow(it)) }
        }
    }

    companion object {
        private const val KEEP_MS = 120_000L
        /** Columns 1-17 are unchanged from RC4 so older readers keep working; new columns are appended. */
        const val CSV_HEADER = "epoch_ms,elapsed_ms,kind,status,source,novelty,sustained,sample_rate_hz,rssi_dbm,csi_amplitude,csi_variance,visible_networks,strongest_rssi_dbm,median_rssi_dbm,band24_count,band5_count,band6_count,measured_rate_hz,packet_loss_pct,synthetic,auth,algorithm,survey_result_age_ms"

        fun csvRow(row: TimedRfSample): String {
            val rf = row.rf
            val survey = row.survey
            return listOf(
                row.epochMs, row.elapsedMs, if (rf != null) "csi" else "wifi_survey",
                rf?.status?.name ?: survey?.status, rf?.source, num(rf?.novelty),
                rf?.sustainedChange, num(rf?.sampleRateHz), num(rf?.rssiDbm), num(rf?.csiAmplitude),
                num(rf?.csiVariance), survey?.visibleNetworks, survey?.strongestRssiDbm,
                survey?.medianRssiDbm, survey?.band24Count, survey?.band5Count, survey?.band6Count,
                num(rf?.measuredRateHz), num(rf?.packetLossPercent), rf?.synthetic, rf?.auth?.name,
                rf?.algorithm, survey?.newestResultAgeMs
            ).joinToString(",") { CsvSafe.cell(it?.toString()) }
        }

        private fun num(v: Float?): String? = v?.takeIf { it.isFinite() }?.toString()
    }
}

/** RFC 4180 quoting plus spreadsheet-formula neutralisation. Leaves ordinary text and numbers untouched. */
object CsvSafe {
    private val NUMBER = Regex("-?\\d+(\\.\\d+)?([eE][-+]?\\d+)?")
    fun cell(value: String?): String {
        if (value.isNullOrEmpty()) return ""
        var v = value.replace(Regex("[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]"), "")
        if (v.isNotEmpty() && v[0] in "=+-@\t\r" && !NUMBER.matches(v)) v = "'$v"
        return if (v.any { it == ',' || it == '"' || it == '\n' || it == '\r' }) "\"" + v.replace("\"", "\"\"") + "\"" else v
    }
}
