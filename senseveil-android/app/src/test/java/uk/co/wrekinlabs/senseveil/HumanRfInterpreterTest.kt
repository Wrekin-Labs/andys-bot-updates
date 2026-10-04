package uk.co.wrekinlabs.senseveil

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class HumanRfInterpreterTest {
    private fun rf(
        status: WifiRfStatus = WifiRfStatus.READY,
        novelty: Float = 0f,
        sustained: Boolean = false,
        rate: Float = 20f,
        loss: Float = 0f,
        rssi: Float? = -52f,
        amp: Float? = 1f,
        variance: Float? = 0.03f,
        synthetic: Boolean = false,
        epoch: Long
    ) = WifiRfReading(
        status = status,
        novelty = novelty,
        sustainedChange = sustained,
        measuredRateHz = rate,
        packetLossPercent = loss,
        rssiDbm = rssi,
        csiAmplitude = amp,
        csiVariance = variance,
        synthetic = synthetic,
        epochMs = epoch
    )

    @Test fun modeOffNeverClassifies() {
        val i = HumanRfInterpreter()
        val out = i.accept(rf(status = WifiRfStatus.RF_CHANGE, novelty = 0.9f, sustained = true, epoch = 1_000), false)
        assertEquals(HumanRfState.OFF, out.state)
    }

    @Test fun calibratedStrongMultichannelChangeBecomesHumanCompatibleMotion() {
        val i = HumanRfInterpreter()
        repeat(10) { n -> i.accept(rf(novelty = 0.05f, epoch = 1_000L + n * 100), true) }
        val out = i.accept(rf(status = WifiRfStatus.RF_CHANGE, novelty = 0.82f, sustained = true, epoch = 2_200), true)
        assertEquals(HumanRfState.HUMAN_COMPATIBLE_MOTION, out.state)
        assertTrue(out.patternConfidence >= 0.60f)
        assertTrue(out.reason.contains("not proof", ignoreCase = true))
    }

    @Test fun rssiOnlyChangeStaysEnvironmental() {
        val i = HumanRfInterpreter()
        val out = i.accept(
            rf(status = WifiRfStatus.RF_CHANGE, novelty = 0.9f, sustained = true, amp = null, variance = null, epoch = 1_000),
            true
        )
        assertEquals(HumanRfState.ENVIRONMENT_CHANGE, out.state)
    }

    @Test fun lowRateOrHighLossCannotBecomeHumanCompatible() {
        val lowRate = HumanRfInterpreter().accept(
            rf(status = WifiRfStatus.RF_CHANGE, novelty = 0.9f, sustained = true, rate = 2f, epoch = 1_000), true
        )
        val highLoss = HumanRfInterpreter().accept(
            rf(status = WifiRfStatus.RF_CHANGE, novelty = 0.9f, sustained = true, loss = 45f, epoch = 1_000), true
        )
        assertEquals(HumanRfState.ENVIRONMENT_CHANGE, lowRate.state)
        assertEquals(HumanRfState.ENVIRONMENT_CHANGE, highLoss.state)
    }

    @Test fun repeatedModerateVariationGetsMotionLikeLabelWithoutPersonClaim() {
        val i = HumanRfInterpreter()
        var out = HumanRfReading()
        repeat(10) { n ->
            out = i.accept(rf(novelty = if (n % 2 == 0) 0.50f else 0.24f, epoch = 1_000L + n * 120L), true)
        }
        assertEquals(HumanRfState.MOTION_LIKE_VARIATION, out.state)
        assertTrue(out.patternConfidence in 0.2f..0.65f)
    }

    @Test fun syntheticDataIsAlwaysClearlyLabelled() {
        val i = HumanRfInterpreter()
        val out = i.accept(
            rf(status = WifiRfStatus.RF_CHANGE, novelty = 0.9f, sustained = true, synthetic = true, epoch = 1_000), true
        )
        assertEquals(HumanRfState.SYNTHETIC_TEST, out.state)
        assertTrue(out.reason.contains("Synthetic"))
        assertTrue(out.patternConfidence <= 0.50f)
    }

    @Test fun movingOrStaleInputClearsHistory() {
        val i = HumanRfInterpreter()
        repeat(10) { n -> i.accept(rf(novelty = 0.5f, epoch = 1_000L + n * 100L), true) }
        assertEquals(HumanRfState.UNAVAILABLE, i.accept(rf(status = WifiRfStatus.PAUSED_MOVING, epoch = 2_100), true).state)
        val ready = i.accept(rf(novelty = 0.5f, epoch = 2_200), true)
        assertEquals(1, ready.sampleCount)
    }
}
