package uk.co.wrekinlabs.senseveil

import org.junit.Assert.*
import org.junit.Test

class MonocularRangeTest {
    private fun estimate(x: Float = 300f, y: Float = 400f, yaw: Float? = 0f, likelihood: Float = .99f) =
        MonocularRange.estimate(x, y, 500f, 400f, likelihood, .99f, 1000, 1600, yaw, 0f)
    @Test fun frontalWellObservedPoseCanReturnCoarseRange() { assertEquals(1.648f, estimate()!!, .01f) }
    @Test fun noFrontalFaceOrLowConfidenceSuppressesRange() {
        assertNull(estimate(yaw = null)); assertNull(estimate(yaw = 45f)); assertNull(estimate(likelihood = .6f))
    }
    @Test fun rotatedOrTinyShoulderSpanDoesNotBecomeFalseLongRange() {
        assertNull(estimate(x = 490f)); assertNull(estimate(y = 600f)); assertNull(estimate(x = -20f))
    }
    @Test fun invalidCoordinatesAreRejected() { assertNull(estimate(x = Float.NaN)); assertNull(estimate(yaw = Float.POSITIVE_INFINITY)) }
}
