package uk.co.wrekinlabs.senseveil

import kotlin.math.abs
import kotlin.math.hypot
import kotlin.math.tan

/** An adult shoulder-size heuristic, never a measured range or AR depth. */
object MonocularRange {
    fun estimate(
        leftX: Float, leftY: Float, rightX: Float, rightY: Float,
        leftLikelihood: Float, rightLikelihood: Float,
        viewWidth: Int, viewHeight: Int, faceYaw: Float?, faceRoll: Float?
    ): Float? {
        if (viewWidth <= 0 || viewHeight <= 0 || faceYaw == null || faceRoll == null) return null
        if (listOf(leftX, leftY, rightX, rightY, leftLikelihood, rightLikelihood, faceYaw, faceRoll).any { !it.isFinite() }) return null
        if (leftLikelihood < 0.8f || rightLikelihood < 0.8f || abs(faceYaw) > 20f || abs(faceRoll) > 20f) return null
        if (leftX !in 0f..viewWidth.toFloat() || rightX !in 0f..viewWidth.toFloat() ||
            leftY !in 0f..viewHeight.toFloat() || rightY !in 0f..viewHeight.toFloat()) return null
        val span = hypot(leftX - rightX, leftY - rightY)
        // Tilted, tiny, clipped or foreshortened shoulders are unsuitable for this heuristic.
        if (span < viewWidth * 0.10f || span > viewWidth * 0.8f || abs(leftY - rightY) > span * 0.3f) return null
        val focal = viewWidth / (2f * tan(Math.toRadians(65.0 / 2)).toFloat())
        return (0.42f * focal / span).takeIf { it in 0.5f..8f }
    }
}
