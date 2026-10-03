package uk.co.wrekinlabs.senseveil

import org.junit.Assert.*
import org.junit.Test

class WifiRfTest {
    private fun frame(
        seq: Long,
        at: Long,
        rate: Float = 20f,
        rssi: Float = -50f,
        amp: Float = 1f,
        variance: Float = 0.02f,
        source: String = "esp32-csi"
    ) = WifiRfFrame(source, seq, 1_800_000_000_000L + at, rate, rssi, amp, variance, at)

    @Test
    fun protocolRequiresVersionPairAndFiniteMeasurements() {
        val ok = """{"v":1,"pair":"abc123456789","source":"esp32-csi","seq":7,"epochMs":1800000000000,"sampleRateHz":20,"rssiDbm":-51,"csiAmplitude":0.93,"csiVariance":0.04}"""
        assertNotNull(WifiRfProtocol.parse(ok, "abc123456789", 1234L))
        assertNull(WifiRfProtocol.parse(ok, "wrong-pair", 1234L))
        assertNull(WifiRfProtocol.parse("""{"v":1,"pair":"abc123456789","source":"x","seq":1,"epochMs":1,"sampleRateHz":0}""", "abc123456789", 1L))
        assertNull(WifiRfProtocol.parse("""{"v":1,"pair":"abc123456789","source":"x","seq":1,"epochMs":1,"sampleRateHz":20,"rssiDbm":"NaN"}""", "abc123456789", 1L))
        assertNull(WifiRfProtocol.parse("""{"v":1,"pair":"abc123456789","source":"bad,source","seq":1,"epochMs":1,"sampleRateHz":20,"rssiDbm":-50}""", "abc123456789", 1L))
        assertNull(WifiRfProtocol.parse("""{"v":1,"pair":"abc123456789","source":"bad\nsource","seq":1,"epochMs":1,"sampleRateHz":20,"rssiDbm":-50}""", "abc123456789", 1L))
    }

    @Test
    fun calibratesThenReportsStableBaseline() {
        val analyzer = WifiRfAnalyzer()
        var reading = WifiRfReading()
        repeat(WifiRfAnalyzer.BASELINE_SAMPLES) { i ->
            reading = analyzer.accept(frame(i.toLong(), i * 100L), false)
        }
        assertEquals(WifiRfStatus.CALIBRATING, reading.status)
        reading = analyzer.accept(frame(30, 3_100L), false)
        assertEquals(WifiRfStatus.READY, reading.status)
        assertFalse(reading.sustainedChange)
        assertTrue(reading.novelty < 0.1f)
    }

    @Test
    fun sustainedRfChangeRequiresMultipleFramesAndTime() {
        val analyzer = WifiRfAnalyzer()
        repeat(WifiRfAnalyzer.BASELINE_SAMPLES) { i ->
            analyzer.accept(frame(i.toLong(), i * 100L), false)
        }
        var reading = WifiRfReading()
        repeat(5) { i ->
            reading = analyzer.accept(
                frame(
                    30L + i,
                    10_000L + i * 250L,
                    rssi = -78f,
                    amp = 1.8f,
                    variance = 0.20f
                ),
                false
            )
        }
        assertEquals(WifiRfStatus.RF_CHANGE, reading.status)
        assertTrue(reading.sustainedChange)
        assertTrue(reading.novelty >= 0.55f)
    }

    @Test
    fun movementLowRateAndStaleDataDoNotBecomeRfChange() {
        val analyzer = WifiRfAnalyzer()
        assertEquals(WifiRfStatus.PAUSED_MOVING, analyzer.accept(frame(1, 1_000L), true).status)
        analyzer.reset()
        assertEquals(WifiRfStatus.UNAVAILABLE, analyzer.accept(frame(1, 1_000L, rate = 1f), false).status)
        analyzer.reset()
        analyzer.accept(frame(1, 1_000L), false)
        val stale = analyzer.stale(1_000L + WifiRfAnalyzer.STALE_MS + 1)
        assertEquals(WifiRfStatus.STALE, stale?.status)
        assertFalse(stale?.sustainedChange ?: true)
    }

    @Test
    fun phoneMovementInvalidatesBaselineAndForcesRecalibration() {
        val analyzer = WifiRfAnalyzer()
        repeat(WifiRfAnalyzer.BASELINE_SAMPLES) { i ->
            analyzer.accept(frame(i.toLong(), i * 100L), false)
        }
        assertEquals(WifiRfStatus.READY, analyzer.accept(frame(30, 3_100L), false).status)

        val moving = analyzer.accept(frame(31, 3_200L, rssi = -78f, amp = 1.8f, variance = 0.20f), true)
        assertEquals(WifiRfStatus.PAUSED_MOVING, moving.status)
        assertEquals(0, moving.baselineSamples)

        val afterMove = analyzer.accept(frame(32, 3_300L, rssi = -78f, amp = 1.8f, variance = 0.20f), false)
        assertEquals(WifiRfStatus.CALIBRATING, afterMove.status)
        assertFalse(afterMove.sustainedChange)
    }

    @Test
    fun wifiSurveyStoresOnlyAggregateSignalStatistics() {
        val reading = WifiSurveyAggregator.aggregate(
            listOf(2412 to -70, 2437 to -40, 5180 to -55, 5975 to -65, 6115 to -60),
            123L
        )
        assertEquals(5, reading.visibleNetworks)
        assertEquals(-40, reading.strongestRssiDbm)
        assertEquals(-60, reading.medianRssiDbm)
        assertEquals(2, reading.band24Count)
        assertEquals(1, reading.band5Count)
        assertEquals(2, reading.band6Count)
    }
}
