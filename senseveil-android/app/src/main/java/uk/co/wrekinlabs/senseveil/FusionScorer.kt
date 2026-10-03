package uk.co.wrekinlabs.senseveil

data class FusionBreakdown(
    val vision: Float,
    val face: Float,
    val field: Float,
    val external: Float,
    val total: Float
)

object FusionScorer {
    fun score(
        profile: DetectionProfile,
        bodyScore: Float,
        facePresent: Boolean,
        sensorNovelty: Float,
        external: ExternalPresenceReading?
    ): FusionBreakdown {
        val vision = bodyScore.coerceIn(0f, 1f) * profile.visionWeight
        val face = (if (facePresent) 1f else 0f) * profile.faceWeight
        val field = sensorNovelty.coerceIn(0f, 1f) * profile.fieldWeight
        val ext = (if (external?.detected == true) external.confidence.coerceIn(0f, 1f) else 0f) * profile.externalWeight
        return FusionBreakdown(vision, face, field, ext, (vision + face + field + ext).coerceIn(0f, 1f))
    }
}
