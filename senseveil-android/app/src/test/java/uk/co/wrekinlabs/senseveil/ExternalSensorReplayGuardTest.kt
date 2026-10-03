package uk.co.wrekinlabs.senseveil

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ExternalSensorReplayGuardTest {
    @Test
    fun rejectsDuplicateSequence() {
        val guard = ExternalSensorReplayGuard()
        val first = ExternalPresenceReading(true, 0.8f, 2f, source = "r1", sensorSequence = 10, sensorEpochMs = 1_000_000)
        assertTrue(guard.check(first, 1_000_100).accepted)
        assertFalse(guard.check(first.copy(receivedEpochMs = 1_000_200), 1_000_200).accepted)
    }

    @Test
    fun acceptsIncreasingSequence() {
        val guard = ExternalSensorReplayGuard()
        assertTrue(guard.check(ExternalPresenceReading(true, 0.8f, 2f, source = "r1", sensorSequence = 10, sensorEpochMs = 1_000_000), 1_000_100).accepted)
        assertTrue(guard.check(ExternalPresenceReading(true, 0.8f, 2f, source = "r1", sensorSequence = 11, sensorEpochMs = 1_000_500), 1_000_600).accepted)
    }
}
