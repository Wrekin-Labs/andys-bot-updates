package uk.co.wrekinlabs.senseveil

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.view.View
import kotlin.math.cos
import kotlin.math.sin

class RadarView(context: Context) : View(context) {
    private var state = DetectionState()
    private var external: ExternalPresenceReading? = null

    private val grid = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = 0x556FC7D7
        style = Paint.Style.STROKE
        strokeWidth = 1.5f
    }
    private val sweep = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = 0x9942E8FF.toInt()
        strokeWidth = 2.5f
    }
    private val visionDot = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Brand.GREEN
        style = Paint.Style.FILL
    }
    private val radarDot = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Brand.MAGENTA
        style = Paint.Style.FILL
    }
    private val devicePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = 0xFFEAFBFF.toInt()
        style = Paint.Style.FILL
    }

    fun update(state: DetectionState, external: ExternalPresenceReading?) {
        this.state = state
        this.external = external
        postInvalidateOnAnimation()
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val cx = width / 2f
        val bottom = height * 0.86f
        val radius = minOf(width * 0.44f, height * 0.78f)

        for (fraction in listOf(0.33f, 0.66f, 1f)) {
            canvas.drawArc(RectF(cx - radius * fraction, bottom - radius * fraction, cx + radius * fraction, bottom + radius * fraction), 180f, 180f, false, grid)
        }
        canvas.drawLine(cx, bottom, cx, bottom - radius, grid)
        canvas.drawLine(cx, bottom, cx - radius * 0.78f, bottom - radius * 0.62f, grid)
        canvas.drawLine(cx, bottom, cx + radius * 0.78f, bottom - radius * 0.62f, grid)
        canvas.drawCircle(cx, bottom, 6f, devicePaint)

        val phase = (System.currentTimeMillis() % 2400L) / 2400f
        val angle = Math.toRadians((205f + phase * 130f).toDouble())
        canvas.drawLine(
            cx,
            bottom,
            cx + cos(angle).toFloat() * radius,
            bottom + sin(angle).toFloat() * radius,
            sweep
        )

        if (state.humanLike) {
            val distance = (state.estimatedDistanceMetres ?: 3f).coerceIn(0.5f, 8f)
            val normalized = (distance / 8f).coerceIn(0.08f, 1f)
            val x = cx + state.horizontalOffset * radius * 0.62f
            val y = bottom - normalized * radius
            canvas.drawCircle(x, y, if (state.anomaly) 9f else 7f, if (state.anomaly) radarDot else visionDot)
        }

        external?.takeIf { it.detected }?.let { reading ->
            val distance = (reading.distanceMetres ?: 3f).coerceIn(0.5f, 8f)
            val normalized = (distance / 8f).coerceIn(0.08f, 1f)
            val x = cx + (reading.lateralOffset ?: 0f).coerceIn(-1f, 1f) * radius * 0.62f
            val y = bottom - normalized * radius
            canvas.drawCircle(x, y, 10f, radarDot)
        }

        if (isShown) postInvalidateDelayed(32L)
    }
}
