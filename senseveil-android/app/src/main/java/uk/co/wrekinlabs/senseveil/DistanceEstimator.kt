package uk.co.wrekinlabs.senseveil

import com.google.mlkit.vision.pose.Pose
import com.google.mlkit.vision.pose.PoseLandmark
import com.google.mlkit.vision.face.Face

object DistanceEstimator {
    /**
     * Coarse monocular estimate only. This is not ARCore Depth and is labelled EST in the UI.
     */
    fun estimateFromPose(pose: Pose?, faces: List<Face>, viewWidthPx: Int, viewHeightPx: Int): Float? {
        if (pose == null) return null
        val left = pose.getPoseLandmark(PoseLandmark.LEFT_SHOULDER) ?: return null
        val right = pose.getPoseLandmark(PoseLandmark.RIGHT_SHOULDER) ?: return null
        val nose = pose.getPoseLandmark(PoseLandmark.NOSE) ?: return null
        // Never borrow another person's frontal face to validate this pose.
        val face = faces.firstOrNull { it.boundingBox.contains(nose.position.x.toInt(), nose.position.y.toInt()) } ?: return null
        return MonocularRange.estimate(left.position.x, left.position.y, right.position.x, right.position.y,
            left.inFrameLikelihood, right.inFrameLikelihood, viewWidthPx, viewHeightPx,
            face.headEulerAngleY, face.headEulerAngleZ)
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
