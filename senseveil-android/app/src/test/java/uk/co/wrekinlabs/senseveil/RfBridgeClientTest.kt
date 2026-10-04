package uk.co.wrekinlabs.senseveil

import org.junit.After
import org.junit.Assert.*
import org.junit.Test
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/**
 * Deterministic in-process integration tests for the RF bridge (no emulator, no Python).
 * The fake bridge is scripted by frame count, and assertions wait on observed states with
 * generous timeouts instead of fixed sleeps.
 */
class RfBridgeClientTest {
    private val pair = "abc123456789"
    private val server = ServerSocket(0, 50, InetAddress.getLoopbackAddress())
    private val accepted = AtomicInteger()
    private val openConnections = Collections.synchronizedList(mutableListOf<Socket>())
    private val readings = Collections.synchronizedList(mutableListOf<WifiRfReading>())
    private val clients = mutableListOf<RfBridgeClient>()

    @After fun tearDown() {
        clients.forEach { it.stop() }
        server.close()
        openConnections.forEach { runCatching { it.close() } }
    }

    private fun client(
        permission: () -> Boolean = { true },
        resolver: (String) -> Array<InetAddress> = { InetAddress.getAllByName(it) },
        timing: RfBridgeClient.Timing = RfBridgeClient.Timing(readTimeoutMs = 200, initialBackoffMs = 100, maxBackoffMs = 400, permissionRetryMs = 100, staleEmitIntervalMs = 100)
    ) = RfBridgeClient(
        config = { RfBridgeConfig("127.0.0.1", server.localPort, pair) },
        hasPermission = permission,
        onReading = { readings.add(it) },
        elapsed = { System.nanoTime() / 1_000_000L }, // android.os.SystemClock is not mocked in JVM unit tests
        resolver = resolver,
        timing = timing
    ).also { clients += it }

    /** Fake ESP32: per connection, validates hello, then runs [script] with a frame sender. */
    private fun serve(script: (send: (String) -> Unit, connection: Int) -> Unit) {
        Thread {
            while (!server.isClosed) {
                val s = runCatching { server.accept() }.getOrNull() ?: break
                val n = accepted.incrementAndGet()
                openConnections += s
                Thread {
                    runCatching {
                        s.use { sock ->
                            val hello = BufferedReader(InputStreamReader(sock.getInputStream())).readLine() ?: return@use
                            assertTrue(hello.contains("\"pair\":\"$pair\""))
                            val out = sock.getOutputStream()
                            script({ out.write((it + "\n").toByteArray()); out.flush() }, n)
                        }
                    }
                }.apply { isDaemon = true }.start()
            }
        }.apply { isDaemon = true }.start()
    }

    private fun frame(seq: Int, rssi: Float = -50f, amp: Float = 1f, variance: Float = 0.02f, epoch: Long = System.currentTimeMillis()) =
        """{"v":1,"pair":"$pair","source":"esp32-csi","seq":$seq,"epochMs":$epoch,"sampleRateHz":50,"rssiDbm":$rssi,"csiAmplitude":$amp,"csiVariance":$variance}"""

    private fun jit(i: Int, s: Float) = (((i * 7919) % 11) - 5) / 5f * s

    /** Readings are consumed in order: each wait only looks at readings after the previous match. */
    private var cursor = 0

    private fun awaitReading(timeoutMs: Long = 5_000, predicate: (WifiRfReading) -> Boolean): WifiRfReading {
        val deadline = System.currentTimeMillis() + timeoutMs
        var seen = cursor
        while (System.currentTimeMillis() < deadline) {
            synchronized(readings) {
                while (seen < readings.size) { val r = readings[seen++]; if (predicate(r)) { cursor = seen; return r } }
            }
            Thread.sleep(5)
        }
        fail("timed out; last readings: " + synchronized(readings) { readings.takeLast(5).map { "${it.status} ${it.message}" } })
        throw AssertionError()
    }

    @Test fun calibratesDetectsChangeThenReconnectForcesRecalibration() {
        val release = CountDownLatch(1)
        serve { send, connection ->
            var seq = 0
            repeat(40) { i -> send(frame(seq++, -50f + jit(i, 1f), 1f + jit(i, 0.02f), 0.02f + jit(i, 0.002f))); Thread.sleep(20) }
            if (connection == 1) {
                repeat(60) { send(frame(seq++, -78f, 1.8f, 0.2f)); Thread.sleep(20) }
                release.await(5, TimeUnit.SECONDS)
            } else {
                Thread.sleep(5_000)
            }
        }
        client().start()
        awaitReading { it.status == WifiRfStatus.CALIBRATING && it.message.contains("connected") }
        awaitReading { it.status == WifiRfStatus.READY }
        val change = awaitReading { it.status == WifiRfStatus.RF_CHANGE }
        assertTrue(change.sustainedChange)
        release.countDown() // bridge drops the connection
        awaitReading { it.status == WifiRfStatus.UNAVAILABLE && it.message.contains("disconnected") }
        val recal = awaitReading { it.status == WifiRfStatus.CALIBRATING && it.baselineSamples in 1..5 }
        assertNotNull(recal)
        assertTrue(accepted.get() >= 2)
    }

    @Test fun noReadingIsDeliveredAfterStopEvenWhileStreaming() {
        serve { send, _ -> var s = 0; while (true) { send(frame(s++)); Thread.sleep(5) } }
        val c = client()
        repeat(5) {
            synchronized(readings) { readings.clear(); cursor = 0 }
            c.start()
            awaitReading { it.status == WifiRfStatus.CALIBRATING && it.baselineSamples > 3 }
            c.stop()
            Thread.sleep(150)
            synchronized(readings) {
                assertEquals("OFF must be the final reading", WifiRfStatus.OFF, readings.last().status)
            }
        }
    }

    @Test fun rapidStartStopLeavesNoOrphanWorkersOrSockets() {
        serve { send, _ -> var s = 0; while (true) { send(frame(s++)); Thread.sleep(10) } }
        val c = client()
        repeat(50) { c.start(); if (it % 3 == 0) Thread.sleep(3); c.stop() }
        c.start()
        awaitReading { it.status == WifiRfStatus.CALIBRATING && it.baselineSamples > 2 }
        c.stop()
        val deadline = System.currentTimeMillis() + 2_000
        while (System.currentTimeMillis() < deadline && Thread.getAllStackTraces().keys.any { it.name.startsWith("SenseVeil-RF") && it.isAlive }) Thread.sleep(10)
        assertFalse("RF worker threads must exit", Thread.getAllStackTraces().keys.any { it.name.startsWith("SenseVeil-RF") && it.isAlive })
    }

    @Test fun stopUnblocksAReadThatWouldOtherwiseWaitForTheTimeout() {
        serve { _, _ -> Thread.sleep(30_000) } // accepts, reads hello, never sends
        val c = client(timing = RfBridgeClient.Timing(readTimeoutMs = 20_000, initialBackoffMs = 100))
        c.start()
        awaitReading { it.status == WifiRfStatus.CALIBRATING }
        Thread.sleep(100)
        val t0 = System.currentTimeMillis()
        c.stop()
        while (Thread.getAllStackTraces().keys.any { it.name.startsWith("SenseVeil-RF") && it.isAlive } && System.currentTimeMillis() - t0 < 3_000) Thread.sleep(5)
        assertTrue("socket close must unblock read promptly", System.currentTimeMillis() - t0 < 1_000)
    }

    @Test fun missingPermissionNeverOpensASocket() {
        serve { _, _ -> }
        client(permission = { false }).start()
        awaitReading { it.status == WifiRfStatus.UNAVAILABLE && it.message.contains("permission") }
        Thread.sleep(300)
        assertEquals(0, accepted.get())
    }

    @Test fun publicHostRefusedByDefault() {
        serve { _, _ -> }
        client(resolver = { arrayOf(InetAddress.getByName("8.8.8.8")) }).start()
        awaitReading { it.status == WifiRfStatus.UNAVAILABLE && it.message.contains("local network") }
        assertEquals(0, accepted.get())
    }

    @Test fun wrongPairStreamProducesDiagnosableStatus() {
        serve { send, _ -> var s = 0; while (true) { send(frame(s++).replace(pair, "not-the-pair")); Thread.sleep(10) } }
        client().start()
        val r = awaitReading { it.status == WifiRfStatus.UNAVAILABLE && it.message.contains("pair code mismatch") }
        assertTrue(r.message.startsWith("no valid RF frames"))
    }

    @Test fun oversizedAndPoisonFramesAreSkippedAndStreamContinues() {
        serve { send, _ ->
            send("x".repeat(10_000))
            send(frame(0).replace("\"csiAmplitude\":1.0", "\"csiAmplitude\":1e300"))
            var s = 1
            while (true) { send(frame(s++)); Thread.sleep(5) }
        }
        client().start()
        val r = awaitReading { it.status == WifiRfStatus.READY }
        assertTrue(r.csiAmplitude!!.isFinite())
    }

    @Test fun staleIsReportedWhenBridgeGoesQuiet() {
        serve { send, _ -> repeat(10) { send(frame(it)); Thread.sleep(20) }; Thread.sleep(10_000) }
        client().start()
        awaitReading { it.status == WifiRfStatus.CALIBRATING && it.baselineSamples >= 10 }
        awaitReading(timeoutMs = 6_000) { it.status == WifiRfStatus.STALE }
    }
}
