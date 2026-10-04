package uk.co.wrekinlabs.senseveil

import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.IOException
import java.io.InputStream
import java.net.InetAddress
import java.net.SocketTimeoutException

class WifiRfProtocolHardeningTest {
    private val pair = "abc123456789"
    private fun line(extra: String = "", source: String = "esp32-csi", seq: String = "7", v: String = "1") =
        """{"v":$v,"pair":"$pair","source":"$source","seq":$seq,"epochMs":1800000000000,"sampleRateHz":20,"rssiDbm":-51,"csiAmplitude":0.93,"csiVariance":0.04$extra}"""
    private fun parse(l: String) = WifiRfProtocol.parseDetailed(l, pair, 1L)
    private fun rejected(l: String) = (parse(l) as? RfParse.Rejected)?.reason

    @Test fun validFrameAccepted() {
        val frame = (parse(line()) as RfParse.Accepted).frame
        assertEquals(RfAuth.PAIR_CODE_ONLY, frame.auth)
        assertFalse(frame.synthetic)
    }

    @Test fun oversizedFrameRejectedBeforeJsonParsing() {
        val huge = line(extra = ""","pad":"${"x".repeat(WifiRfProtocol.MAX_FRAME_BYTES)}"""")
        assertEquals("oversized frame", rejected(huge))
    }

    @Test fun malformedJsonAndMissingFieldsRejected() {
        assertEquals("malformed JSON", rejected("{not json"))
        assertNotNull(rejected("""{"v":1,"pair":"$pair","source":"x","epochMs":1,"sampleRateHz":20,"rssiDbm":-50}""")) // no seq
        assertNotNull(rejected("""{"v":1,"pair":"$pair","source":"x","seq":1,"sampleRateHz":20,"rssiDbm":-50}"""))     // no epoch
        assertNotNull(rejected("""{"v":1,"pair":"$pair","source":"x","seq":1,"epochMs":1,"rssiDbm":-50}"""))           // no rate
        assertEquals("no RF measurement in frame", rejected("""{"v":1,"pair":"$pair","source":"x","seq":1,"epochMs":1,"sampleRateHz":20}"""))
    }

    @Test fun repeatedKeysNeverThrow() {
        // Android's org.json keeps the last duplicate; the JVM json.org artifact throws. Either way: no crash,
        // and an accepted frame still had to carry the right pair code.
        val dup = """{"v":1,"pair":"wrong","pair":"$pair","source":"a","seq":1,"seq":2,"epochMs":1,"sampleRateHz":20,"rssiDbm":-50}"""
        val result = parse(dup)
        if (result is RfParse.Accepted) assertEquals(2L, result.frame.sequence)
    }

    @Test fun sourceMustBeShortSafeAndStartAlphanumeric() {
        assertNotNull(rejected(line(source = "a".repeat(65))))
        assertNotNull(rejected(line(source = "-A1+cmd")))
        assertNotNull(rejected(line(source = "=HYPERLINK(1)")))
        assertNotNull(rejected(line(source = "bad,source")))
        assertNotNull(rejected(line(source = "bad\\nsource")))
        assertNotNull(rejected(line(source = "café")))
        assertNull(rejected(line(source = "esp32-s3.room_1:a")))
    }

    @Test fun nonFiniteAndHugeNumbersRejected() {
        // 1e300 is a finite double but becomes Float.Infinity; RC4 accepted it and poisoned the baseline.
        assertNotNull(rejected("""{"v":1,"pair":"$pair","source":"x","seq":1,"epochMs":1,"sampleRateHz":20,"csiAmplitude":1e300}"""))
        assertNotNull(rejected("""{"v":1,"pair":"$pair","source":"x","seq":1,"epochMs":1,"sampleRateHz":20,"csiVariance":1e39}"""))
        assertNotNull(rejected("""{"v":1,"pair":"$pair","source":"x","seq":1,"epochMs":1,"sampleRateHz":20,"rssiDbm":"NaN"}"""))
        assertNotNull(rejected("""{"v":1,"pair":"$pair","source":"x","seq":1,"epochMs":1,"sampleRateHz":20,"rssiDbm":"-50"}""")) // strings are not numbers
        assertNotNull(rejected(line(extra = ""","rssiDbm":-500""").replace(""""rssiDbm":-51,""", ""))) // out of range is an error, not silently dropped
    }

    @Test fun sequenceMustBeExactSafeInteger() {
        assertNotNull(rejected(line(seq = "1e300")))          // would clamp to Long.MAX and lock out the stream
        assertNotNull(rejected(line(seq = "1152921504606846976"))) // 2^60 > 2^53
        assertNotNull(rejected(line(seq = "1.5")))
        assertNotNull(rejected(line(seq = "\"7\"")))
        assertNotNull(rejected(line(seq = "-1")))
        assertNotNull(rejected(line(v = "\"1\"")))
        assertNotNull(rejected(line(v = "1.5")))
    }

    @Test fun mockSourceAndSyntheticFlagAreMarked() {
        assertTrue((parse(line(source = "mock-rf-not-real-csi")) as RfParse.Accepted).frame.synthetic)
        assertTrue((parse(line(extra = ""","synthetic":true""")) as RfParse.Accepted).frame.synthetic)
    }

    @Test fun v2CrossLanguageVector() {
        // Same vector as tools/test_mock_rf_bridge.py — Kotlin, Python and ESP32 firmware must agree.
        val json = """{"v":2,"source":"esp32-csi","seq":1,"epochMs":1800000000000,"sampleRateHz":20,"rssiDbm":-51}"""
        val mac = WifiRfProtocol.v2Mac(ByteArray(32) { it.toByte() }, "00112233445566778899aabbccddeeff", json)
        assertEquals("ee2db01e92ca71b48f704a8c30006eef6da2a634aba677273de5b20f917d157e", mac.joinToString("") { "%02x".format(it) })
    }

    @Test fun macAddressShapedSourceRejected() {
        // Keeps device identifiers (BSSID-like) out of evidence even if bridge firmware uses its MAC as id.
        assertEquals("source looks like a hardware address", rejected(line(source = "a4:cf:12:9b:00:7e")))
        assertEquals("source looks like a hardware address", rejected(line(source = "esp-A4CF129B007E")))
        assertNull(rejected(line(source = "esp32-csi-01")))
    }

    @Test fun v2HmacFramesAuthenticateAndBindToNonce() {
        val key = ByteArray(32) { it.toByte() }
        val nonce = "00112233445566778899aabbccddeeff"
        val json = """{"v":2,"source":"esp32-csi","seq":1,"epochMs":1800000000000,"sampleRateHz":20,"rssiDbm":-51}"""
        fun frame(k: ByteArray, n: String, body: String) =
            WifiRfProtocol.V2_PREFIX + WifiRfProtocol.v2Mac(k, n, body).joinToString("") { "%02x".format(it) } + " " + body
        val ok = WifiRfProtocol.parseDetailed(frame(key, nonce, json), pair, 1L, key, nonce)
        assertEquals(RfAuth.HMAC_V2, (ok as RfParse.Accepted).frame.auth)
        val tampered = frame(key, nonce, json).replace("-51", "-71")
        assertEquals("v2 MAC mismatch", (WifiRfProtocol.parseDetailed(tampered, pair, 1L, key, nonce) as RfParse.Rejected).reason)
        val replayedFromOtherConnection = frame(key, "ffffffffffffffffffffffffffffffff", json)
        assertTrue(WifiRfProtocol.parseDetailed(replayedFromOtherConnection, pair, 1L, key, nonce) is RfParse.Rejected)
        assertTrue(WifiRfProtocol.parseDetailed(line(), pair, 1L, key, nonce, requireV2 = true) is RfParse.Rejected)
        assertTrue(WifiRfProtocol.parseDetailed(frame(key, nonce, json), pair, 1L, null, null) is RfParse.Rejected)
    }
}

class WifiRfAnalyzerRobustnessTest {
    private val base = 1_800_000_000_000L
    /** at = phone receive time; sensorAt defaults to the same instant (in-sync bridge). */
    private fun frame(seq: Long, at: Long, rssi: Float? = -50f, amp: Float? = 1f, variance: Float? = 0.02f,
                      rate: Float = 20f, source: String = "esp32-csi", sensorAt: Long = at) =
        WifiRfFrame(source, seq, base + sensorAt, rate, rssi, amp, variance, at, receivedEpochMs = base + at)

    private fun jitter(i: Int, scale: Float) = (((i * 7919) % 11) - 5) / 5f * scale

    private fun calibrated(analyzer: WifiRfAnalyzer = WifiRfAnalyzer(), startSeq: Long = 0, startAt: Long = 0): WifiRfAnalyzer {
        repeat(WifiRfAnalyzer.BASELINE_SAMPLES) { i ->
            analyzer.accept(frame(startSeq + i, startAt + i * 50L, rssi = -50f + jitter(i, 1f), amp = 1f + jitter(i, 0.02f),
                variance = 0.02f + jitter(i, 0.002f)), false)
        }
        return analyzer
    }

    @Test fun calibrationReportsProgressThenReady() {
        val a = WifiRfAnalyzer()
        val first = a.accept(frame(0, 0), false)
        assertEquals(WifiRfStatus.CALIBRATING, first.status)
        assertTrue(first.message.contains("1/30"))
        calibrated(a, startSeq = 1, startAt = 50)
        assertEquals(WifiRfStatus.READY, a.accept(frame(100, 5_000), false).status)
    }

    @Test fun strongCorroboratedChangeBecomesSustainedAfterTimeAndFrames() {
        val a = calibrated()
        var r = WifiRfReading()
        for (i in 0 until 4) r = a.accept(frame(100L + i, 5_000L + i * 250, rssi = -78f, amp = 1.8f, variance = 0.2f), false)
        assertEquals("4 frames is not enough", WifiRfStatus.READY, r.status)
        r = a.accept(frame(104, 6_000, rssi = -78f, amp = 1.8f, variance = 0.2f), false)
        assertEquals(WifiRfStatus.RF_CHANGE, r.status)
        assertTrue(r.sustainedChange)
        assertTrue(r.novelty >= 0.55f && r.novelty.isFinite())
        assertEquals(WifiRfAnalyzer.ALGORITHM, r.algorithm)
    }

    @Test fun burstOfBufferedFramesDoesNotSatisfyDurationBySensorTime() {
        val a = calibrated()
        var r = WifiRfReading()
        // Ten frames whose sensor timestamps span only 150 ms (a real 150 ms blip), delivered later.
        for (i in 0 until 10) r = a.accept(frame(100L + i, 5_000L + i * 50, rssi = -78f, amp = 1.8f, variance = 0.2f,
            sensorAt = 5_000L + i * 15), false)
        assertNotEquals(WifiRfStatus.RF_CHANGE, r.status)
    }

    @Test fun singleChannelSpikeWithoutCorroborationIsNotAChange() {
        val a = calibrated()
        var r = WifiRfReading()
        for (i in 0 until 20) r = a.accept(frame(100L + i, 5_000L + i * 100, variance = 0.5f), false)
        assertEquals(WifiRfStatus.READY, r.status)
    }

    @Test fun rssiOnlyBridgeCanStillReportChange() {
        val a = WifiRfAnalyzer()
        repeat(30) { i -> a.accept(frame(i.toLong(), i * 50L, rssi = -50f + jitter(i, 1f), amp = null, variance = null), false) }
        var r = WifiRfReading()
        for (i in 0 until 10) r = a.accept(frame(100L + i, 5_000L + i * 200, rssi = -70f, amp = null, variance = null), false)
        assertEquals(WifiRfStatus.RF_CHANGE, r.status)
    }

    @Test fun quantisedRssiWithZeroMadUsesNoiseFloor() {
        val a = WifiRfAnalyzer()
        repeat(30) { i -> a.accept(frame(i.toLong(), i * 50L, rssi = -50f, amp = null, variance = null), false) }
        var r = WifiRfReading()
        for (i in 0 until 20) r = a.accept(frame(100L + i, 5_000L + i * 100, rssi = if (i % 2 == 0) -51f else -49f, amp = null, variance = null), false)
        assertEquals(WifiRfStatus.READY, r.status)
        assertTrue(r.novelty < 0.2f)
    }

    @Test fun hysteresisToleratesOneDipAndExitsAfterQuietRun() {
        val a = calibrated()
        var t = 5_000L; var s = 100L
        fun push(rssi: Float, amp: Float, v: Float) = a.accept(frame(s++, t.also { t += 200 }, rssi, amp, v), false)
        repeat(6) { push(-78f, 1.8f, 0.2f) }
        assertEquals(WifiRfStatus.RF_CHANGE, push(-78f, 1.8f, 0.2f).status)
        assertEquals("one quiet frame must not drop the latch", WifiRfStatus.RF_CHANGE, push(-50f, 1f, 0.02f).status)
        assertEquals(WifiRfStatus.RF_CHANGE, push(-78f, 1.8f, 0.2f).status)
        var r = WifiRfReading()
        repeat(WifiRfAnalyzer.EXIT_QUIET_FRAMES) { r = push(-50f, 1f, 0.02f) }
        assertEquals(WifiRfStatus.READY, r.status)
    }

    @Test fun persistentChangeRebaselinesInsteadOfLatchingForever() {
        val a = calibrated()
        var r = WifiRfReading()
        var seq = 100L
        var t = 5_000L
        while (t < 5_000L + WifiRfAnalyzer.REBASELINE_AFTER_MS + 2_000) {
            r = a.accept(frame(seq++, t, rssi = -78f, amp = 1.8f, variance = 0.2f), false)
            if (r.status == WifiRfStatus.CALIBRATING) break
            t += 250
        }
        assertEquals(WifiRfStatus.CALIBRATING, r.status)
        assertTrue(r.message.contains("re-baselining"))
    }

    @Test fun sequenceReplayRejectedButCounterRestartRecovers() {
        val a = calibrated()
        a.accept(frame(500, 5_000), false)
        assertEquals(WifiRfStatus.UNAVAILABLE, a.accept(frame(500, 5_050), false).status)
        assertEquals(WifiRfStatus.UNAVAILABLE, a.accept(frame(10, 5_100), false).status)
        assertEquals(WifiRfStatus.UNAVAILABLE, a.accept(frame(11, 5_150), false).status)
        val restarted = a.accept(frame(12, 5_200), false)
        assertEquals("third increasing rolled-back frame = bridge restart", WifiRfStatus.CALIBRATING, restarted.status)
        assertEquals(1, restarted.baselineSamples)
    }

    @Test fun sensorClockJumpResetsBaseline() {
        val a = calibrated()
        assertEquals(WifiRfStatus.READY, a.accept(frame(100, 5_000), false).status)
        val back = a.accept(frame(101, 5_050, sensorAt = 1_000), false)
        assertEquals(WifiRfStatus.CALIBRATING, back.status)
        assertTrue(back.message.contains("clock"))
    }

    @Test fun unsynchronisedSensorClockIsRecordedNotRejected() {
        val a = WifiRfAnalyzer()
        // ESP32 without NTP: epochMs is millis since boot.
        val r = a.accept(WifiRfFrame("esp32", 1, 12_345, 20f, -50f, null, null, 1_000, receivedEpochMs = base), false)
        assertEquals(WifiRfStatus.CALIBRATING, r.status)
        assertEquals(false, r.sensorClockSynced)
    }

    @Test fun delayedFramesAreExcludedFromClassification() {
        val a = calibrated()
        var r = WifiRfReading()
        // Sensor time advances 200 ms per frame but frames arrive 3 s late (buffered after a Wi-Fi stall).
        for (i in 0 until 10) r = a.accept(frame(100L + i, 8_000L + i * 200, rssi = -78f, amp = 1.8f, variance = 0.2f,
            sensorAt = 5_000L + i * 200), false)
        assertEquals(WifiRfStatus.READY, r.status)
        assertTrue(r.message.contains("delayed"))
    }

    @Test fun lowMeasuredRateBecomesUnavailableEvenIfDeclaredRateIsHigh() {
        val a = WifiRfAnalyzer()
        var r = WifiRfReading()
        for (i in 0 until 15) r = a.accept(frame(i.toLong(), i * 1_000L), false) // declares 20 Hz, delivers 1 Hz
        assertEquals(WifiRfStatus.UNAVAILABLE, r.status)
        assertTrue(r.message.contains("effective"))
    }

    @Test fun movementInvalidatesAndReconnectResetForcesRecalibration() {
        val a = calibrated()
        assertEquals(WifiRfStatus.PAUSED_MOVING, a.accept(frame(100, 5_000), true).status)
        assertEquals(1, a.accept(frame(101, 5_050), false).baselineSamples)
        calibrated(a, 200, 6_000)
        a.reset() // what RfBridgeClient does on every (re)connect
        assertEquals(1, a.accept(frame(0, 9_000), false).baselineSamples)
    }

    @Test fun longStaleGapDropsBaseline() {
        val a = calibrated()
        a.accept(frame(100, 5_000), false)
        assertEquals(WifiRfStatus.STALE, a.stale(5_000 + WifiRfAnalyzer.STALE_MS + 1)?.status)
        assertEquals(WifiRfStatus.STALE, a.stale(5_000 + WifiRfAnalyzer.STALE_REBASELINE_MS + 1)?.status)
        assertEquals(1, a.accept(frame(101, 16_000), false).baselineSamples)
    }

    @Test fun extremeButValidValuesStayFinite() {
        val a = WifiRfAnalyzer()
        var r = WifiRfReading()
        repeat(40) { i -> r = a.accept(frame(i.toLong(), i * 50L, rssi = -140f, amp = WifiRfProtocol.MAX_CSI_AMPLITUDE,
            variance = if (i % 2 == 0) 0f else WifiRfProtocol.MAX_CSI_VARIANCE), false) }
        assertTrue(r.novelty.isFinite())
        org.json.JSONObject().put("n", r.novelty).put("a", r.csiAmplitude) // must not throw "Forbidden numeric value"
    }

    @Test fun csvNeutralisesFormulaAndQuotesDelimiters() {
        assertEquals("'=1+1", CsvSafe.cell("=1+1"))
        assertEquals("-55.2", CsvSafe.cell("-55.2"))
        assertEquals("\"a,b\"", CsvSafe.cell("a,b"))
        assertEquals("\"line\nbreak\"", CsvSafe.cell("line\nbreak"))
        assertEquals("ab", CsvSafe.cell("a\u0000b"))
        val row = RfTimeline.csvRow(TimedRfSample(1, 2, survey = WifiSurveyReading(status = "scan throttled, cached")))
        assertEquals(RfTimeline.CSV_HEADER.split(',').size, Regex(",(?=(?:[^\"]*\"[^\"]*\")*[^\"]*$)").split(row).size)
    }
}

class BoundedLineReaderTest {
    private fun reader(text: String, max: Int = 16) = BoundedLineReader(ByteArrayInputStream(text.toByteArray()), max)

    @Test fun readsLinesStripsCrAndSignalsEof() {
        val r = reader("abc\r\ndef\n")
        assertEquals(BoundedLineReader.Line.Text("abc"), r.readLine())
        assertEquals(BoundedLineReader.Line.Text("def"), r.readLine())
        assertNull(r.readLine())
    }

    @Test fun oversizedLineIsDiscardedAndStreamResynchronises() {
        val r = reader("x".repeat(40) + "\nok\n")
        assertTrue(r.readLine() is BoundedLineReader.Line.Oversized)
        assertEquals(BoundedLineReader.Line.Text("ok"), r.readLine())
    }

    @Test(expected = IOException::class)
    fun endlessLineAbortsConnection() { reader("y".repeat(16 * 64 + 10))
        .readLine() }

    @Test fun invalidUtf8Reported() {
        val r = BoundedLineReader(ByteArrayInputStream(byteArrayOf(0xC3.toByte(), 0x28, '\n'.code.toByte())), 16)
        assertTrue(r.readLine() is BoundedLineReader.Line.InvalidUtf8)
    }

    @Test fun frameSplitAcrossReadTimeoutIsNotCorrupted() {
        val bytes = "hello\n".toByteArray()
        var i = 0
        var timedOut = false
        val input = object : InputStream() {
            override fun read(): Int {
                if (i == 3 && !timedOut) { timedOut = true; throw SocketTimeoutException() }
                return if (i < bytes.size) bytes[i++].toInt() else -1
            }
        }
        val r = BoundedLineReader(input, 16)
        try { r.readLine(); fail("expected timeout") } catch (_: SocketTimeoutException) { }
        assertEquals(BoundedLineReader.Line.Text("hello"), r.readLine())
    }
}

class RfHostPolicyTest {
    private fun local(h: String) = RfHostPolicy.isLocal(InetAddress.getByName(h))

    @Test fun privateLinkLocalLoopbackAndUlaAreLocal() {
        listOf("192.168.4.1", "10.1.2.3", "172.16.0.9", "172.31.255.1", "169.254.10.2", "127.0.0.1", "::1", "fe80::1", "fd12:3456::1")
            .forEach { assertTrue(it, local(it)) }
    }

    @Test fun publicCgnatWildcardAndMulticastAreNotLocal() {
        listOf("8.8.8.8", "172.32.0.1", "100.64.0.1", "0.0.0.0", "224.0.0.251", "2001:4860:4860::8888")
            .forEach { assertFalse(it, local(it)) }
    }

    @Test fun hostSyntax() {
        assertTrue(RfHostPolicy.isSyntacticallyValid("192.168.4.1"))
        assertTrue(RfHostPolicy.isSyntacticallyValid("esp32-csi.local"))
        assertFalse(RfHostPolicy.isSyntacticallyValid("http://x"))
        assertFalse(RfHostPolicy.isSyntacticallyValid("a b"))
        assertFalse(RfHostPolicy.isSyntacticallyValid(""))
    }
}

class MotionGateTest {
    @Test fun entersImmediatelyAndLeavesOnlyAfterSettling() {
        val g = MotionGate()
        assertFalse(g.update(9.8f, 0))
        assertTrue(g.update(12.5f, 10))      // spike -> moving
        assertTrue(g.moving)
        assertFalse(g.update(9.8f, 100))
        assertFalse(g.update(11.2f, 600))     // between thresholds resets the quiet timer
        assertFalse(g.update(9.8f, 700))
        assertFalse(g.update(9.8f, 2_100))    // only 1.4 s quiet
        assertTrue(g.update(9.8f, 2_250))     // 1.55 s quiet -> stationary
        assertFalse(g.moving)
    }

    @Test fun tremorDoesNotFlap() {
        val g = MotionGate()
        g.update(12f, 0)
        var changes = 0
        for (i in 1..100) if (g.update(if (i % 7 == 0) 11.9f else 9.8f, i * 60L)) changes++
        assertEquals("repeated spikes keep it moving instead of toggling", 0, changes)
    }
}
