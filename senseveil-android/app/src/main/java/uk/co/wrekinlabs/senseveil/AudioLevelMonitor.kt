package uk.co.wrekinlabs.senseveil

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import androidx.core.content.ContextCompat
import kotlin.concurrent.thread
import kotlin.math.log10
import kotlin.math.sqrt

class AudioLevelMonitor(
    private val context: Context,
    private val onLevel: (Float?) -> Unit
) {
    @Volatile private var running = false
    private var recorder: AudioRecord? = null
    private var worker: Thread? = null
    @Volatile private var generation = 0L

    @Synchronized
    fun start() {
        if (running) return
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            onLevel(null)
            return
        }

        val sampleRate = 16_000
        val min = AudioRecord.getMinBufferSize(
            sampleRate,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT
        )
        if (min <= 0) {
            onLevel(null)
            return
        }

        val source = if (android.os.Build.VERSION.SDK_INT >= 24) MediaRecorder.AudioSource.UNPROCESSED else MediaRecorder.AudioSource.MIC
        val audioRecord = try { AudioRecord(
            source,
            sampleRate,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
            min * 2
        ) } catch (_: Exception) { onLevel(null); return }
        if (audioRecord.state != AudioRecord.STATE_INITIALIZED) {
            audioRecord.release()
            onLevel(null)
            return
        }

        try { audioRecord.startRecording() } catch (_: Exception) {
            audioRecord.release(); onLevel(null); return
        }
        recorder = audioRecord
        val runGeneration = ++generation
        running = true
        worker = thread(name = "senseveil-audio-meter", isDaemon = true) {
            val buffer = ShortArray(min)
            try {
            while (running && generation == runGeneration) {
                val read = runCatching { audioRecord.read(buffer, 0, buffer.size) }.getOrDefault(-1)
                if (read < 0) break
                if (read > 0) {
                    var sum = 0.0
                    for (i in 0 until read) {
                        val normalized = buffer[i] / 32768.0
                        sum += normalized * normalized
                    }
                    val rms = sqrt(sum / read).coerceAtLeast(1e-9)
                    val dbfs = (20.0 * log10(rms)).toFloat().coerceIn(-120f, 0f)
                    if (running && generation == runGeneration) onLevel(dbfs)
                }
            }
            } finally {
                runCatching { audioRecord.release() }
                if (generation == runGeneration) { running = false; onLevel(null) }
            }
        }
    }

    @Synchronized
    fun stop() {
        running = false
        generation++
        try { recorder?.stop() } catch (_: Throwable) { }
        recorder = null
        worker = null
        onLevel(null)
    }
}
