package uk.co.wrekinlabs.senseveil

import android.content.Context
import android.os.Handler
import android.os.Looper
import androidx.camera.video.FileOutputOptions
import androidx.camera.video.Recording
import androidx.camera.video.VideoRecordEvent
import androidx.camera.view.LifecycleCameraController
import androidx.camera.view.video.AudioConfig
import androidx.core.content.ContextCompat
import java.io.File
import java.util.ArrayDeque

class RollingVideoBuffer(
    private val context: Context,
    private val cameraController: LifecycleCameraController,
    private val repository: EventRepository,
    private val onStatus: (String) -> Unit
) {
    private val main = Handler(Looper.getMainLooper())
    private val segments = ArrayDeque<File>()
    private var activeFile: File? = null
    private var recording: Recording? = null
    private var enabled = false
    private val preserveNextSegmentInto = linkedMapOf<File, (String) -> Unit>()
    private var performanceMode: PerformanceMode = PerformanceMode.BALANCED

    private val rotate = Runnable {
        recording?.stop()
    }

    fun setPerformanceMode(mode: PerformanceMode) {
        performanceMode = mode
        trimSegments()
        onStatus("BUFFER ${historySeconds()}s • ${mode.label.uppercase()}")
    }

    fun start() {
        if (enabled) return
        enabled = true
        startSegment()
    }

    fun stop() {
        enabled = false
        main.removeCallbacks(rotate)
        recording?.stop()
        onStatus("BUFFER OFF")
    }

    fun markEvent(bundle: File, onReady: (String) -> Unit = {}): File {
        segments.takeLastCompat(maxSegments()).forEachIndexed { index, file ->
            copySafely(file, File(bundle, "pre_${index + 1}_${file.name}"))
        }
        if (!enabled || recording == null) {
            onReady("unavailable")
            return bundle
        }
        preserveNextSegmentInto[bundle] = onReady
        // Remove the producer before reporting timeout: a late Finalize must not
        // append unsigned media to an already sealed bundle.
        main.postDelayed({ preserveNextSegmentInto.remove(bundle)?.invoke("timeout") }, 30_000L)
        onStatus("BUFFER SAVING EVENT")
        return bundle
    }

    private fun startSegment() {
        if (!enabled || recording != null) return
        val file = repository.newVideoSegmentFile()
        activeFile = file
        val output = FileOutputOptions.Builder(file).build()

        try {
            recording = cameraController.startRecording(
                output,
                AudioConfig.AUDIO_DISABLED,
                ContextCompat.getMainExecutor(context)
            ) { event ->
                when (event) {
                    is VideoRecordEvent.Start -> {
                        onStatus("BUFFER ${historySeconds()}s")
                        main.removeCallbacks(rotate)
                        main.postDelayed(rotate, SEGMENT_MS)
                    }
                    is VideoRecordEvent.Finalize -> {
                        main.removeCallbacks(rotate)
                        recording = null
                        val finished = file
                        activeFile = null

                        if (finished.exists() && finished.length() > 0L) {
                            segments.addLast(finished)
                            trimSegments()
                            preserveNextSegmentInto.forEach { (bundle, ready) ->
                                val copied = copySafely(finished, File(bundle, "post_${finished.name}"))
                                ready(if (!copied) "copy_failed" else if (event.hasError()) "partial" else "saved")
                            }
                            preserveNextSegmentInto.clear()
                        } else {
                            finished.delete()
                            preserveNextSegmentInto.values.forEach { it("unavailable") }
                            preserveNextSegmentInto.clear()
                        }

                        if (event.hasError()) {
                            onStatus("BUFFER DEGRADED (${event.error})")
                        }
                        if (enabled) main.postDelayed({ startSegment() }, 250L)
                    }
                }
            }
        } catch (t: Throwable) {
            recording = null
            enabled = false
            file.delete()
            onStatus("BUFFER UNAVAILABLE")
        }
    }

    private fun maxSegments(): Int = when (performanceMode) {
        PerformanceMode.QUALITY -> 4
        PerformanceMode.BALANCED -> 3
        PerformanceMode.BATTERY_SAVER -> 2
    }

    private fun historySeconds(): Int = (maxSegments() * SEGMENT_MS / 1000L).toInt()

    private fun trimSegments() {
        while (segments.size > maxSegments()) {
            val old = segments.removeFirst()
            old.delete()
        }
    }

    private fun copySafely(source: File, target: File): Boolean = try {
        source.copyTo(target, overwrite = true)
        true
    } catch (_: Exception) { false }

    private fun <T> ArrayDeque<T>.takeLastCompat(count: Int): List<T> =
        toList().takeLast(count)

    companion object {
        private const val SEGMENT_MS = 8_000L
    }
}
