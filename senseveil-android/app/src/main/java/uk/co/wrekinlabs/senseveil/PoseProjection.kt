package uk.co.wrekinlabs.senseveil

import android.graphics.Matrix
import android.graphics.PointF
import android.util.Size
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.mlkit.vision.MlKitAnalyzer
import com.google.mlkit.vision.pose.Pose

data class ProjectedLandmark(val landmarkType: Int, val position: PointF, val inFrameLikelihood: Float)
data class ProjectedPose(val allPoseLandmarks: List<ProjectedLandmark>) {
    fun getPoseLandmark(type: Int) = allPoseLandmarks.firstOrNull { it.landmarkType == type }
}

/**
 * ML Kit pose-detection-common 18.0.0-beta5 constructs Pose with a null transform.
 * Faces/objects honor MlKitAnalyzer's transform, but pose points stay in the upright
 * analysis buffer. Keep a transform keyed to that exact frame; never guess a scale
 * from screen size or transform faces/objects a second time.
 */
class PoseProjection {
    @Volatile private var sensorToView: Matrix? = null
    private val frames = LinkedHashMap<Long, Matrix>()

    fun wrap(delegate: MlKitAnalyzer): ImageAnalysis.Analyzer = object : ImageAnalysis.Analyzer {
        override fun getTargetCoordinateSystem() = delegate.targetCoordinateSystem
        override fun getDefaultTargetResolution(): Size = delegate.defaultTargetResolution
        override fun updateTransform(matrix: Matrix?) {
            sensorToView = matrix?.let(::Matrix)
            synchronized(frames) { frames.clear() }
            delegate.updateTransform(matrix)
        }
        override fun analyze(image: ImageProxy) {
            sensorToView?.let { target ->
                uprightToView(image.width, image.height, image.imageInfo.rotationDegrees,
                    image.imageInfo.sensorToBufferTransformMatrix, target)?.let { transform ->
                    synchronized(frames) {
                        frames[image.imageInfo.timestamp] = transform
                        while (frames.size > 8) frames.remove(frames.keys.first())
                    }
                }
            }
            delegate.analyze(image)
        }
    }

    fun project(pose: Pose?, timestamp: Long): ProjectedPose? {
        val transform = synchronized(frames) { frames.remove(timestamp) } ?: return null
        if (pose == null) return null
        return ProjectedPose(pose.allPoseLandmarks.map { landmark ->
            val xy = floatArrayOf(landmark.position.x, landmark.position.y)
            transform.mapPoints(xy)
            ProjectedLandmark(landmark.landmarkType, PointF(xy[0], xy[1]), landmark.inFrameLikelihood)
        })
    }

    companion object {
        /** Map rotated analysis pixels through the sensor into the actual CameraX viewport. */
        fun uprightToView(width: Int, height: Int, rotation: Int, sensorToBuffer: Matrix, sensorToView: Matrix): Matrix? {
            if (width <= 0 || height <= 0) return null
            val w = width.toFloat(); val h = height.toFloat()
            val source = floatArrayOf(0f, 0f, w, 0f, w, h, 0f, h)
            val target = when (rotation) {
                0 -> source.copyOf()
                90 -> floatArrayOf(h, 0f, h, w, 0f, w, 0f, 0f)
                180 -> floatArrayOf(w, h, 0f, h, 0f, 0f, w, 0f)
                270 -> floatArrayOf(0f, w, 0f, 0f, h, 0f, h, w)
                else -> return null
            }
            val bufferToUpright = Matrix()
            if (!bufferToUpright.setPolyToPoly(source, 0, target, 0, 4)) return null
            val sensorToUpright = Matrix(sensorToBuffer).apply { postConcat(bufferToUpright) }
            val result = Matrix()
            if (!sensorToUpright.invert(result)) return null
            result.postConcat(sensorToView)
            return result
        }
    }
}
