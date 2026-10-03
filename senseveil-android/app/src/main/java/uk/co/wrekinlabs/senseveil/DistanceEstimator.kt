package uk.co.wrekinlabs.senseveil

import com.google.mlkit.vision.pose.Pose
import com.google.mlkit.vision.pose.PoseLandmark
import kotlin.math.abs
import kotlin.math.tan

object DistanceEstimator {
    private const val ASSUMED_SHOULDER_WIDTH_M = 0.42f
    private const val APPROX_HORIZONTAL_FOV_DEG = 65f

    /**
     * Coarse monocular estimate only. This is not ARCore Depth and is labelled EST in the UI.
     */
    fun estimateFromPose(pose: Pose?, viewWidthPx: Int): Float? {
        if (pose == null || viewWidthPx <= 0) return null
        val left = pose.getPoseLandmark(PoseLandmark.LEFT_SHOULDER) ?: return null
        val right = pose.getPoseLandmark(PoseLandmark.RIGHT_SHOULDER) ?: return null
        if (left.inFrameLikelihood < 0.55f || right.inFrameLikelihood < 0.55f) return null

        val shoulderPx = abs(left.position.x - right.position.x)
        if (shoulderPx < 12f) return null

        val focalPx = viewWidthPx / (2f * tan(Math.toRadians(APPROX_HORIZONTAL_FOV_DEG / 2.0)).toFloat())
        val distance = ASSUMED_SHOULDER_WIDTH_M * focalPx / shoulderPx
        return distance.coerceIn(0.35f, 25f)
    }

    fun horizontalOffset(pose: Pose?, viewWidthPx: Int): Float {
        if (pose == null || viewWidthPx <= 0) return 0f
        val points = pose.allPoseLandmarks
            .filter { it.inFrameLikelihood >= 0.45f }
            .map { it.position.x }
        if (points.isEmpty()) return 0f
        val center = points.average().toFloat()
        return (((center / viewWidthPx) - 0.5f) * 2f).coerceIn(-1f, 1f)
    }
}
