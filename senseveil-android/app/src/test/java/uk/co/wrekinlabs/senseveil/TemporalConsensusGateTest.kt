package uk.co.wrekinlabs.senseveil

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TemporalConsensusGateTest {
    @Test
    fun doesNotTriggerOnSingleFrameSpike() {
        val gate = TemporalConsensusGate()
        val first = gate.update("vision:H01", true, 8, 6, 600L, 1_000L)
        assertFalse(first.sustained)
        val second = gate.update("vision:H01", false, 8, 6, 600L, 1_100L)
        assertFalse(second.sustained)
    }

    @Test
    fun triggersAfterRequiredFramesAndDuration() {
        val gate = TemporalConsensusGate()
        var result = gate.update("vision:H01", true, 8, 6, 500L, 1_000L)
        for (i in 1..6) {
            result = gate.update("vision:H01", true, 8, 6, 500L, 1_000L + i * 100L)
        }
        assertTrue(result.sustained)
    }

    @Test
    fun changingTargetResetsConsensus() {
        val gate = TemporalConsensusGate()
        repeat(6) { i -> gate.update("vision:H01", true, 8, 6, 0L, i * 100L) }
        val changed = gate.update("vision:H02", true, 8, 6, 0L, 1_000L)
        assertFalse(changed.sustained)
    }
}
