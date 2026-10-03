package uk.co.wrekinlabs.senseveil

import org.junit.Assert.assertTrue
import org.junit.Test

class FusionScorerTest {
    @Test
    fun externalEvidenceRaisesScore() {
        val base = FusionScorer.score(DetectionProfile.BALANCED, 0.6f, false, 0f, null)
        val external = FusionScorer.score(
            DetectionProfile.BALANCED,
            0.6f,
            false,
            0f,
            ExternalPresenceReading(true, 0.9f, 2.4f, source = "test")
        )
        assertTrue(external.total > base.total)
    }
}
