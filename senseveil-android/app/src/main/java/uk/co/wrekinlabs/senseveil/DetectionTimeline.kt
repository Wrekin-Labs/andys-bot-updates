package uk.co.wrekinlabs.senseveil

import android.os.SystemClock
import org.json.JSONObject
import java.io.File
import java.util.ArrayDeque

data class TimedDetectionSample(
    val elapsedMs: Long,
    val wallEpochMs: Long,
    val state: DetectionState
)

class DetectionTimeline {
    private val samples = ArrayDeque<TimedDetectionSample>()
    private var lastAddedAt = 0L

    @Synchronized
    fun add(state: DetectionState) {
        val now = SystemClock.elapsedRealtime()
        if (now - lastAddedAt < SAMPLE_MS) return
        lastAddedAt = now
        samples.addLast(TimedDetectionSample(now, System.currentTimeMillis(), state))
        val cutoff = now - KEEP_MS
        while (samples.isNotEmpty() && samples.first().elapsedMs < cutoff) samples.removeFirst()
    }

    @Synchronized
    fun window(eventElapsedMs: Long, beforeMs: Long, afterMs: Long): List<TimedDetectionSample> =
        samples.filter { it.elapsedMs in (eventElapsedMs - beforeMs)..(eventElapsedMs + afterMs) }

    fun writeJsonl(file: File, rows: List<TimedDetectionSample>) {
        file.parentFile?.mkdirs()
        file.bufferedWriter().use { out ->
            rows.forEach { row ->
                val s = row.state
                out.appendLine(
                    JSONObject().apply {
                        put("epochMs", row.wallEpochMs)
                        put("elapsedMs", row.elapsedMs)
                        put("humanLike", s.humanLike)
                        put("candidateAnomaly", s.candidateAnomaly)
                        put("anomaly", s.anomaly)
                        put("track", s.trackLabel ?: JSONObject.NULL)
                        put("bodyScore", s.bodyScore)
                        put("fusedScore", s.fusedScore)
                        put("sceneQuality", s.sceneQuality.score)
                        put("sceneQualityLabel", s.sceneQuality.label)
                        put("consensusPositiveFrames", s.consensusPositiveFrames)
                        put("consensusWindowFrames", s.consensusWindowFrames)
                        put("consensusRatio", s.consensusRatio)
                        put("consensusAgeMs", s.consensusAgeMs)
                        put("anomalyReason", s.anomalyReason ?: JSONObject.NULL)
                        put("explanation", s.explanation.toJson())
                    }.toString()
                )
            }
        }
    }

    companion object {
        private const val SAMPLE_MS = 250L
        private const val KEEP_MS = 120_000L
    }
}
