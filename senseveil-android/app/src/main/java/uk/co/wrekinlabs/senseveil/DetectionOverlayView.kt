package uk.co.wrekinlabs.senseveil

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PointF
import android.graphics.Rect
import android.graphics.RectF
import android.view.View
import com.google.mlkit.vision.face.Face
import com.google.mlkit.vision.objects.DetectedObject
import com.google.mlkit.vision.pose.PoseLandmark

class DetectionOverlayView(context: Context) : View(context) {

    private var pose: ProjectedPose? = null
    private var faces: List<Face> = emptyList()
    private var objects: List<DetectedObject> = emptyList()
    private var state = DetectionState()
    private var labMode = false

    private val skeletonPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Brand.CYAN
        strokeWidth = 4f
        style = Paint.Style.STROKE
    }
    private val jointPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.WHITE
        style = Paint.Style.FILL
    }
    private val facePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Brand.GREEN
        strokeWidth = 3f
        style = Paint.Style.STROKE
    }
    private val objectPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Brand.AMBER
        strokeWidth = 2f
        style = Paint.Style.STROKE
    }
    private val anomalyPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Brand.MAGENTA
        strokeWidth = 5f
        style = Paint.Style.STROKE
    }
    private val candidatePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Brand.AMBER
        strokeWidth = 3f
        style = Paint.Style.STROKE
        pathEffect = android.graphics.DashPathEffect(floatArrayOf(16f, 10f), 0f)
    }
    private val reticlePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = 0x5579DCEA
        strokeWidth = 1f
        style = Paint.Style.STROKE
    }
    private val labelBg = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = 0xD90B0E12.toInt()
        style = Paint.Style.FILL
    }
    private val labelPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.WHITE
        textSize = android.util.TypedValue.applyDimension(android.util.TypedValue.COMPLEX_UNIT_SP, 13f, resources.displayMetrics)
        typeface = android.graphics.Typeface.MONOSPACE
    }
    private val objectLabelPaint = Paint(labelPaint).apply { textSize = android.util.TypedValue.applyDimension(android.util.TypedValue.COMPLEX_UNIT_SP, 11f, resources.displayMetrics); color = Brand.AMBER }

    fun update(
        pose: ProjectedPose?,
        faces: List<Face>,
        objects: List<DetectedObject>,
        state: DetectionState,
        labMode: Boolean
    ) {
        this.pose = pose
        this.faces = faces
        this.objects = objects
        this.state = state
        this.labMode = labMode
        postInvalidateOnAnimation()
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        drawReticle(canvas)
        if (labMode) {
            objects.forEach { drawObject(canvas, it) }
            faces.forEach { drawRect(canvas, it.boundingBox, facePaint) }
            drawPose(canvas)
        }

        poseBounds()?.let { box ->
            if (state.anomaly) {
                canvas.drawRect(box.left.toFloat(), box.top.toFloat(), box.right.toFloat(), box.bottom.toFloat(), anomalyPaint)
            } else if (state.candidateAnomaly) {
                canvas.drawRect(box.left.toFloat(), box.top.toFloat(), box.right.toFloat(), box.bottom.toFloat(), candidatePaint)
            } else if (!labMode && state.humanLike) {
                canvas.drawRoundRect(RectF(box), 12f, 12f, facePaint)
            }
            if (state.humanLike) drawLabel(canvas, box)
        }
    }

    private fun drawReticle(canvas: Canvas) {
        val cx = width / 2f
        val cy = height / 2f
        canvas.drawCircle(cx, cy, minOf(width, height) * 0.14f, reticlePaint)
        canvas.drawLine(cx - 38f, cy, cx + 38f, cy, reticlePaint)
        canvas.drawLine(cx, cy - 38f, cx, cy + 38f, reticlePaint)
        if (labMode) {
            canvas.drawLine(width * 0.33f, 0f, width * 0.33f, height.toFloat(), reticlePaint)
            canvas.drawLine(width * 0.66f, 0f, width * 0.66f, height.toFloat(), reticlePaint)
        }
    }

    private fun drawLabel(canvas: Canvas, box: Rect) {
        val confidence = (state.fusedScore * 100f).toInt().coerceIn(0, 100)
        val prefix = when {
            labMode && state.anomaly -> "CONSENSUS Δ"
            state.anomaly -> "ANOMALY"
            labMode && state.candidateAnomaly -> "CANDIDATE"
            else -> "HUMAN"
        }
        val text = if (labMode) "$prefix ${state.trackLabel ?: "--"} • $confidence%" else "${state.trackLabel ?: "PERSON"} • TRACKING"
        val widthText = labelPaint.measureText(text)
        val lineHeight = labelPaint.fontSpacing + 16f
        val left = box.left.toFloat().coerceIn(8f, maxOf(8f, width - widthText - 32f))
        val top = (box.top - lineHeight).coerceIn(8f, maxOf(8f, height - lineHeight - 8f))
        canvas.drawRoundRect(RectF(left, top, left + widthText + 24f, top + lineHeight), 8f, 8f, labelBg)
        canvas.drawText(text, left + 12f, top + 8f - labelPaint.ascent(), labelPaint)
    }

    private fun drawPose(canvas: Canvas) {
        val links = listOf(
            PoseLandmark.LEFT_SHOULDER to PoseLandmark.RIGHT_SHOULDER,
            PoseLandmark.LEFT_SHOULDER to PoseLandmark.LEFT_ELBOW,
            PoseLandmark.LEFT_ELBOW to PoseLandmark.LEFT_WRIST,
            PoseLandmark.RIGHT_SHOULDER to PoseLandmark.RIGHT_ELBOW,
            PoseLandmark.RIGHT_ELBOW to PoseLandmark.RIGHT_WRIST,
            PoseLandmark.LEFT_SHOULDER to PoseLandmark.LEFT_HIP,
            PoseLandmark.RIGHT_SHOULDER to PoseLandmark.RIGHT_HIP,
            PoseLandmark.LEFT_HIP to PoseLandmark.RIGHT_HIP,
            PoseLandmark.LEFT_HIP to PoseLandmark.LEFT_KNEE,
            PoseLandmark.LEFT_KNEE to PoseLandmark.LEFT_ANKLE,
            PoseLandmark.RIGHT_HIP to PoseLandmark.RIGHT_KNEE,
            PoseLandmark.RIGHT_KNEE to PoseLandmark.RIGHT_ANKLE
        )

        links.forEach { (a, b) ->
            val pa = point(a)
            val pb = point(b)
            if (pa != null && pb != null) canvas.drawLine(pa.x, pa.y, pb.x, pb.y, skeletonPaint)
        }
        pose?.allPoseLandmarks
            ?.filter { it.inFrameLikelihood >= 0.65f && it.position.x.isFinite() && it.position.y.isFinite() && it.position.x in 0f..width.toFloat() && it.position.y in 0f..height.toFloat() }
            ?.forEach { canvas.drawCircle(it.position.x, it.position.y, 5.5f, jointPaint) }
    }

    private fun point(type: Int): PointF? {
        val landmark = pose?.getPoseLandmark(type) ?: return null
        return if (landmark.inFrameLikelihood >= 0.45f) landmark.position else null
    }

    private fun poseBounds(): Rect? {
        val points = pose?.allPoseLandmarks
            ?.filter { it.inFrameLikelihood >= 0.65f && it.position.x.isFinite() && it.position.y.isFinite() && it.position.x in 0f..width.toFloat() && it.position.y in 0f..height.toFloat() }
            ?.map { it.position }
            .orEmpty()
        if (points.size < 4) return null
        return Rect(
            points.minOf { it.x }.toInt(),
            points.minOf { it.y }.toInt(),
            points.maxOf { it.x }.toInt(),
            points.maxOf { it.y }.toInt()
        )
    }


    private fun drawObject(canvas: Canvas, detected: DetectedObject) {
        drawRect(canvas, detected.boundingBox, objectPaint)
        if (!labMode) return
        val label = detected.labels.firstOrNull()?.text?.takeIf { it.isNotBlank() } ?: return
        val text = "OBJ ${detected.trackingId ?: "--"} ${label.uppercase()}"
        val small = objectLabelPaint
        val widthText = small.measureText(text)
        val left = detected.boundingBox.left.toFloat().coerceIn(6f, maxOf(6f, width - widthText - 24f))
        val top = (detected.boundingBox.bottom + 6).toFloat().coerceAtMost(height - 34f)
        canvas.drawRoundRect(RectF(left, top, left + widthText + 18f, top + 30f), 6f, 6f, labelBg)
        canvas.drawText(text, left + 9f, top + 23f, small)
    }

    private fun drawRect(canvas: Canvas, rect: Rect, paint: Paint) {
        canvas.drawRect(rect.left.toFloat(), rect.top.toFloat(), rect.right.toFloat(), rect.bottom.toFloat(), paint)
    }
}
