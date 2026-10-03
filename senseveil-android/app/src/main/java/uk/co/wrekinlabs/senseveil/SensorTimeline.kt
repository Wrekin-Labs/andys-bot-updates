package uk.co.wrekinlabs.senseveil

import android.os.SystemClock
import java.io.File
import java.util.ArrayDeque

data class TimedSensorSample(
    val elapsedMs: Long,
    val wallEpochMs: Long,
    val snapshot: SensorSnapshot
)

class SensorTimeline {
    private val samples = ArrayDeque<TimedSensorSample>()
    private var lastAddedAt = 0L

    @Synchronized
    fun add(snapshot: SensorSnapshot) {
        val now = SystemClock.elapsedRealtime()
        if (now - lastAddedAt < SAMPLE_MS) return
        lastAddedAt = now
        samples.addLast(TimedSensorSample(now, System.currentTimeMillis(), snapshot))
        val cutoff = now - KEEP_MS
        while (samples.isNotEmpty() && samples.first().elapsedMs < cutoff) samples.removeFirst()
    }

    @Synchronized
    fun window(eventElapsedMs: Long, beforeMs: Long, afterMs: Long): List<TimedSensorSample> =
        samples.filter { it.elapsedMs in (eventElapsedMs - beforeMs)..(eventElapsedMs + afterMs) }

    fun writeCsv(file: File, rows: List<TimedSensorSample>) {
        file.parentFile?.mkdirs()
        file.bufferedWriter().use { out ->
            out.appendLine("epoch_ms,elapsed_ms,magnetic_uT,light_lux,accel_ms2,pressure_hPa,audio_dbfs,novelty")
            rows.forEach { row ->
                val s = row.snapshot
                out.append(row.wallEpochMs.toString()).append(',')
                out.append(row.elapsedMs.toString()).append(',')
                out.append(s.magneticMicroTesla?.toString() ?: "").append(',')
                out.append(s.lightLux?.toString() ?: "").append(',')
                out.append(s.accelerationMs2?.toString() ?: "").append(',')
                out.append(s.pressureHpa?.toString() ?: "").append(',')
                out.append(s.audioDbfs?.toString() ?: "").append(',')
                out.appendLine(s.novelty.toString())
            }
        }
    }

    companion object {
        private const val SAMPLE_MS = 250L
        private const val KEEP_MS = 120_000L
    }
}
