package uk.co.wrekinlabs.senseveil

data class SceneQuality(
    val score: Float,
    val label: String,
    val issues: List<String>
)

object SceneQualityEvaluator {
    fun evaluate(lowLight: Boolean, deviceMoving: Boolean, strongLandmarks: Int): SceneQuality {
        var score = 1f
        val issues = mutableListOf<String>()
        if (lowLight) {
            score -= 0.30f
            issues += "low light"
        }
        if (deviceMoving) {
            score -= 0.40f
            issues += "phone moving"
        }
        if (strongLandmarks in 1..7) {
            score -= 0.12f
            issues += "partial pose"
        }
        score = score.coerceIn(0f, 1f)
        val label = when {
            score >= 0.85f -> "excellent"
            score >= 0.65f -> "good"
            score >= 0.45f -> "limited"
            else -> "poor"
        }
        return SceneQuality(score, label, issues)
    }
}
