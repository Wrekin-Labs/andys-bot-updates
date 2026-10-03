package uk.co.wrekinlabs.senseveil

import android.os.SystemClock

data class DetectionState(
    val humanLike: Boolean = false,
    val facePresent: Boolean = false,
    val objectCount: Int = 0,
    val objectLabels: List<String> = emptyList(),
    val bodyScore: Float = 0f,
    val fusedScore: Float = 0f,
    val candidateAnomaly: Boolean = false,
    val anomaly: Boolean = false,
    val anomalyReason: String? = null,
    val consensusPositiveFrames: Int = 0,
    val consensusWindowFrames: Int = 0,
    val consensusRatio: Float = 0f,
    val consensusAgeMs: Long = 0L,
    val trackLabel: String? = null,
    val trackStability: Float = 0f,
    val estimatedDistanceMetres: Float? = null,
    val horizontalOffset: Float = 0f,
    val strongLandmarks: Int = 0,
    val sensorNovelty: Float = 0f,
    val lowLight: Boolean = false,
    val deviceMoving: Boolean = false,
    val sceneQuality: SceneQuality = SceneQuality(1f, "excellent", emptyList()),
    val explanation: DetectionExplanation = DetectionExplanation.idle(),
    val fusion: FusionBreakdown = FusionBreakdown(0f, 0f, 0f, 0f, 0f),
    val timestampMs: Long = SystemClock.elapsedRealtime()
)

class PersonTrackState {
    private var nextId = 1
    private var activeId: Int? = null
    private var lastSeenAt = 0L
    private var firstSeenAt = 0L
    private var consecutiveFrames = 0

    fun update(present: Boolean, now: Long = SystemClock.elapsedRealtime()): TrackObservation {
        if (present) {
            if (activeId == null || now - lastSeenAt > LOST_TIMEOUT_MS) {
                activeId = nextId++
                firstSeenAt = now
                consecutiveFrames = 0
            }
            consecutiveFrames++
            lastSeenAt = now
            val ageFactor = ((now - firstSeenAt) / 1_500f).coerceIn(0f, 1f)
            val frameFactor = (consecutiveFrames / 12f).coerceIn(0f, 1f)
            return TrackObservation("H%02d".format(activeId), (ageFactor * 0.55f + frameFactor * 0.45f))
        }

        if (activeId != null && now - lastSeenAt > LOST_TIMEOUT_MS) {
            activeId = null
            consecutiveFrames = 0
        }
        return TrackObservation(activeId?.let { "H%02d".format(it) }, 0f)
    }

    companion object { private const val LOST_TIMEOUT_MS = 2_500L }
}

data class TrackObservation(val label: String?, val stability: Float)
