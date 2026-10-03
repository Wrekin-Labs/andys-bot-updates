package uk.co.wrekinlabs.senseveil

import org.junit.Assert.*
import org.junit.Test

class CaptureCompletionTest {
    @Test fun waitsForLateVideoAndSealsExactlyOnce() {
        val seals = mutableListOf<String>()
        val capture = CaptureCompletion { seals += it }
        capture.imageReady()
        capture.windowReady()
        assertTrue(seals.isEmpty())
        capture.videoReady("partial")
        capture.videoReady("saved")
        capture.windowReady()
        assertEquals(listOf("partial"), seals)
    }

    @Test fun unavailableVideoStillAllowsPhotoAndTelemetry() {
        var sealed = false
        val capture = CaptureCompletion { sealed = true }
        capture.videoReady("unavailable")
        capture.windowReady()
        assertFalse(sealed)
        capture.imageReady()
        assertTrue(sealed)
    }

    @Test fun failedCaptureCannotBeSealedByLateCallbacks() {
        val capture = CaptureCompletion { fail("Failed capture was signed") }
        capture.imageReady()
        capture.fail()
        capture.videoReady("saved")
        capture.windowReady()
    }
}
