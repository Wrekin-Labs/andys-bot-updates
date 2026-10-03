package uk.co.wrekinlabs.senseveil

import org.json.JSONArray
import org.json.JSONObject

enum class EvidenceDirection { SUPPORTS, OPPOSES, NEUTRAL }

data class ExplanationFactor(
    val name: String,
    val direction: EvidenceDirection,
    val value: String,
    val detail: String
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("name", name)
        put("direction", direction.name.lowercase())
        put("value", value)
        put("detail", detail)
    }
}

data class DetectionExplanation(
    val headline: String,
    val factors: List<ExplanationFactor>
) {
    val summary: String
        get() = buildString {
            append(headline)
            factors.take(5).forEach { factor ->
                append(" | ").append(factor.name).append(':').append(factor.value)
            }
        }

    fun toJson(): JSONObject = JSONObject().apply {
        put("headline", headline)
        put("factors", JSONArray().apply { factors.forEach { put(it.toJson()) } })
    }

    companion object {
        fun idle() = DetectionExplanation("No sustained anomaly", emptyList())
    }
}

object DetectionExplanationBuilder {
    fun build(
        humanLike: Boolean,
        facePresent: Boolean,
        objectLabels: List<String>,
        strongLandmarks: Int,
        bodyScore: Float,
        lowLight: Boolean,
        deviceMoving: Boolean,
        trackStability: Float,
        sensorNovelty: Float,
        external: ExternalPresenceReading?,
        candidateReason: String?,
        consensus: ConsensusDecision
    ): DetectionExplanation {
        val factors = mutableListOf<ExplanationFactor>()
        factors += ExplanationFactor(
            "Pose",
            if (humanLike) EvidenceDirection.SUPPORTS else EvidenceDirection.OPPOSES,
            "${strongLandmarks}/33",
            "Body model confidence ${(bodyScore * 100).toInt()}%"
        )
        factors += ExplanationFactor(
            "Track",
            if (trackStability >= 0.35f) EvidenceDirection.SUPPORTS else EvidenceDirection.NEUTRAL,
            "${(trackStability * 100).toInt()}%",
            "Temporal target stability"
        )
        factors += ExplanationFactor(
            "Face",
            if (facePresent) EvidenceDirection.SUPPORTS else EvidenceDirection.NEUTRAL,
            if (facePresent) "present" else "not found",
            "Face detector cross-check"
        )
        factors += ExplanationFactor(
            "Scene",
            if (!lowLight && !deviceMoving) EvidenceDirection.SUPPORTS else EvidenceDirection.OPPOSES,
            when {
                deviceMoving -> "moving"
                lowLight -> "low light"
                else -> "stable"
            },
            "Phone motion and illumination quality"
        )
        if (objectLabels.isNotEmpty()) {
            factors += ExplanationFactor(
                "Objects",
                EvidenceDirection.NEUTRAL,
                objectLabels.joinToString(","),
                "Context from ML object classification"
            )
        }
        factors += ExplanationFactor(
            "Field",
            if (sensorNovelty >= 0.55f) EvidenceDirection.SUPPORTS else EvidenceDirection.NEUTRAL,
            "${(sensorNovelty * 100).toInt()}%",
            "Environmental sensor novelty"
        )
        external?.let {
            factors += ExplanationFactor(
                it.sensorType.name,
                if (it.detected) EvidenceDirection.SUPPORTS else EvidenceDirection.OPPOSES,
                "${(it.confidence * 100).toInt()}%",
                "External source ${it.source}"
            )
        }
        factors += ExplanationFactor(
            "Consensus",
            if (consensus.sustained) EvidenceDirection.SUPPORTS else EvidenceDirection.NEUTRAL,
            "${consensus.positiveFrames}/${consensus.totalFrames}",
            "${consensus.ageMs} ms persistence"
        )

        val headline = when {
            consensus.sustained && !candidateReason.isNullOrBlank() -> "Sustained: $candidateReason"
            !candidateReason.isNullOrBlank() -> "Candidate only: $candidateReason"
            else -> "No sustained anomaly"
        }
        return DetectionExplanation(headline, factors)
    }
}
