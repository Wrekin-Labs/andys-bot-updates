package uk.co.wrekinlabs.senseveil

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.view.View

class BrandMarkView(context: Context) : View(context) {
    private val ring = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Brand.CYAN
        style = Paint.Style.STROKE
        strokeWidth = 5f
    }
    private val pulse = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Brand.MAGENTA
        style = Paint.Style.STROKE
        strokeWidth = 4f
    }
    private val core = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = 0xFFEAFBFF.toInt()
        style = Paint.Style.FILL
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val cx = width / 2f
        val cy = height / 2f
        val r = minOf(width, height) * 0.31f
        canvas.drawCircle(cx, cy, r, ring)
        canvas.drawArc(RectF(cx - r * 1.38f, cy - r * 1.38f, cx + r * 1.38f, cy + r * 1.38f), -42f, 84f, false, pulse)
        canvas.drawArc(RectF(cx - r * 1.7f, cy - r * 1.7f, cx + r * 1.7f, cy + r * 1.7f), 138f, 84f, false, pulse)
        canvas.drawCircle(cx, cy, r * 0.18f, core)
        canvas.drawLine(cx - r * 1.65f, cy, cx - r * 0.62f, cy, ring)
        canvas.drawLine(cx + r * 0.62f, cy, cx + r * 1.65f, cy, ring)
    }
}
