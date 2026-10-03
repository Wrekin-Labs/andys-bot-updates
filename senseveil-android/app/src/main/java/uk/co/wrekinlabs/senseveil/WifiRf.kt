package uk.co.wrekinlabs.senseveil

import android.os.SystemClock
import org.json.JSONObject
import java.io.File
import java.util.ArrayDeque
import kotlin.math.abs
import kotlin.math.max

enum class WifiRfStatus { OFF, CONNECTING, CALIBRATING, READY, RF_CHANGE, PAUSED_MOVING, UNAVAILABLE, STALE }

data class WifiRfFrame(
    val source: String,
    val sequence: Long,
    val sensorEpochMs: Long,
    val sampleRateHz: Float,
    val rssiDbm: Float?,
    val csiAmplitude: Float?,
    val csiVariance: Float?,
    val receivedElapsedMs: Long
)

data class WifiRfReading(
    val status: WifiRfStatus = WifiRfStatus.OFF,
    val source: String? = null,
    val novelty: Float = 0f,
    val sustainedChange: Boolean = false,
    val baselineSamples: Int = 0,
    val sampleRateHz: Float? = null,
    val rssiDbm: Float? = null,
    val csiAmplitude: Float? = null,
    val csiVariance: Float? = null,
    val message: String = "RF sensing off",
    val epochMs: Long = System.currentTimeMillis()
)

data class WifiSurveyReading(
    val visibleNetworks: Int = 0,
    val strongestRssiDbm: Int? = null,
    val medianRssiDbm: Int? = null,
    val band24Count: Int = 0,
    val band5Count: Int = 0,
    val band6Count: Int = 0,
    val status: String = "off",
    val epochMs: Long = System.currentTimeMillis()
)

object WifiRfProtocol {
    fun parse(line: String, expectedPairCode: String, nowElapsedMs: Long = SystemClock.elapsedRealtime()): WifiRfFrame? {
        val j = runCatching { JSONObject(line) }.getOrNull() ?: return null
        if (j.optInt("v", -1) != 1 || j.optString("pair") != expectedPairCode) return null
        val source = j.optString("source").trim().takeIf { it.isNotEmpty() && it.length <= 80 } ?: return null
        val seq = j.optLong("seq", -1L).takeIf { it >= 0 } ?: return null
        val epoch = j.optLong("epochMs", -1L).takeIf { it > 0 } ?: return null
        val rate = finite(j, "sampleRateHz")?.takeIf { it > 0f && it <= 1000f } ?: return null
        val rssi = finite(j, "rssiDbm")?.takeIf { it in -140f..20f }
        val amp = finite(j, "csiAmplitude")?.takeIf { it >= 0f }
        val variance = finite(j, "csiVariance")?.takeIf { it >= 0f }
        if (rssi == null && amp == null && variance == null) return null
        return WifiRfFrame(source, seq, epoch, rate, rssi, amp, variance, nowElapsedMs)
    }

    private fun finite(j: JSONObject, name: String): Float? {
        if (!j.has(name) || j.isNull(name)) return null
        return runCatching { j.getDouble(name) }.getOrNull()?.takeIf { it.isFinite() }?.toFloat()
    }
}

class WifiRfAnalyzer {
    private var source: String? = null
    private var lastSequence = -1L
    private var lastReceivedElapsed = 0L
    private var baselineRssi: Float? = null
    private var baselineAmplitude: Float? = null
    private var baselineVariance: Float? = null
    private var baselineSamples = 0
    private var positiveSince = 0L
    private var positiveFrames = 0

    @Synchronized
    fun reset() {
        source = null
        lastSequence = -1L
        lastReceivedElapsed = 0L
        baselineRssi = null
        baselineAmplitude = null
        baselineVariance = null
        baselineSamples = 0
        clearPositive()
    }

    @Synchronized
    fun accept(frame: WifiRfFrame, deviceMoving: Boolean): WifiRfReading {
        if (source != null && source != frame.source) reset()
        source = frame.source
        if (frame.sequence <= lastSequence) return unavailable(frame, "out-of-order RF frame")
        lastSequence = frame.sequence
        lastReceivedElapsed = frame.receivedElapsedMs

        if (frame.sampleRateHz < MIN_RATE_HZ) {
            clearPositive()
            return unavailable(frame, "CSI/RF sample rate too low")
        }
        if (deviceMoving) {
            clearPositive()
            return reading(frame, WifiRfStatus.PAUSED_MOVING, 0f, false, "paused while phone is moving")
        }

        if (baselineSamples < BASELINE_SAMPLES) {
            updateBaseline(frame, if (baselineSamples == 0) 1f else 0.12f)
            baselineSamples++
            clearPositive()
            return reading(frame, WifiRfStatus.CALIBRATING, 0f, false, "calibrating stationary RF baseline")
        }

        val novelty = novelty(frame)
        if (novelty < 0.28f) updateBaseline(frame, 0.01f)
        if (novelty >= NOVELTY_THRESHOLD) {
            if (positiveFrames == 0) positiveSince = frame.receivedElapsedMs
            positiveFrames++
        } else {
            clearPositive()
        }
        val sustained = positiveFrames >= MIN_POSITIVE_FRAMES &&
            frame.receivedElapsedMs - positiveSince >= MIN_POSITIVE_MS
        return reading(
            frame,
            if (sustained) WifiRfStatus.RF_CHANGE else WifiRfStatus.READY,
            novelty,
            sustained,
            if (sustained) "sustained RF change from stationary baseline" else "RF baseline stable"
        )
    }

    @Synchronized
    fun stale(nowElapsedMs: Long = SystemClock.elapsedRealtime()): WifiRfReading? {
        if (lastReceivedElapsed == 0L || nowElapsedMs - lastReceivedElapsed <= STALE_MS) return null
        clearPositive()
        return WifiRfReading(
            status = WifiRfStatus.STALE,
            source = source,
            baselineSamples = baselineSamples,
            message = "RF bridge data is stale"
        )
    }

    private fun novelty(frame: WifiRfFrame): Float {
        val rssiDelta = scaledDelta(frame.rssiDbm, baselineRssi, 12f)
        val ampDelta = scaledDelta(frame.csiAmplitude, baselineAmplitude, max(abs(baselineAmplitude ?: 0f) * 0.28f, 0.05f))
        val varianceDelta = scaledDelta(frame.csiVariance, baselineVariance, max(abs(baselineVariance ?: 0f) * 1.5f, 0.02f))
        return max(rssiDelta * 0.55f, max(ampDelta, varianceDelta)).coerceIn(0f, 1f)
    }

    private fun scaledDelta(value: Float?, baseline: Float?, scale: Float): Float =
        if (value == null || baseline == null || scale <= 0f) 0f else (abs(value - baseline) / scale).coerceIn(0f, 1f)

    private fun updateBaseline(frame: WifiRfFrame, alpha: Float) {
        baselineRssi = ema(baselineRssi, frame.rssiDbm, alpha)
        baselineAmplitude = ema(baselineAmplitude, frame.csiAmplitude, alpha)
        baselineVariance = ema(baselineVariance, frame.csiVariance, alpha)
    }

    private fun ema(previous: Float?, value: Float?, alpha: Float): Float? {
        if (value == null) return previous
        return if (previous == null) value else previous + alpha * (value - previous)
    }

    private fun reading(frame: WifiRfFrame, status: WifiRfStatus, novelty: Float, sustained: Boolean, message: String) =
        WifiRfReading(status, frame.source, novelty, sustained, baselineSamples, frame.sampleRateHz,
            frame.rssiDbm, frame.csiAmplitude, frame.csiVariance, message)

    private fun unavailable(frame: WifiRfFrame, message: String) =
        reading(frame, WifiRfStatus.UNAVAILABLE, 0f, false, message)

    private fun clearPositive() {
        positiveFrames = 0
        positiveSince = 0L
    }

    companion object {
        const val BASELINE_SAMPLES = 30
        const val MIN_RATE_HZ = 4f
        const val STALE_MS = 2_500L
        private const val NOVELTY_THRESHOLD = 0.55f
        private const val MIN_POSITIVE_FRAMES = 5
        private const val MIN_POSITIVE_MS = 800L
    }
}

object WifiSurveyAggregator {
    fun aggregate(samples: List<Pair<Int, Int>>, epochMs: Long = System.currentTimeMillis()): WifiSurveyReading {
        if (samples.isEmpty()) return WifiSurveyReading(status = "no scan results", epochMs = epochMs)
        val rssis = samples.map { it.second }.sorted()
        return WifiSurveyReading(
            visibleNetworks = samples.size,
            strongestRssiDbm = rssis.maxOrNull(),
            medianRssiDbm = rssis[rssis.size / 2],
            band24Count = samples.count { it.first in 2_400..2_500 },
            band5Count = samples.count { it.first in 4_900..5_900 },
            band6Count = samples.count { it.first in 5_925..7_125 },
            status = "aggregate scan ready",
            epochMs = epochMs
        )
    }
}

data class TimedRfSample(
    val elapsedMs: Long,
    val epochMs: Long,
    val rf: WifiRfReading? = null,
    val survey: WifiSurveyReading? = null
)

class RfTimeline {
    private val samples = ArrayDeque<TimedRfSample>()

    @Synchronized
    fun addRf(value: WifiRfReading) = add(TimedRfSample(SystemClock.elapsedRealtime(), System.currentTimeMillis(), rf = value))

    @Synchronized
    fun addSurvey(value: WifiSurveyReading) = add(TimedRfSample(SystemClock.elapsedRealtime(), System.currentTimeMillis(), survey = value))

    @Synchronized
    fun window(eventElapsedMs: Long, beforeMs: Long, afterMs: Long): List<TimedRfSample> =
        samples.filter { it.elapsedMs in (eventElapsedMs - beforeMs)..(eventElapsedMs + afterMs) }

    @Synchronized
    private fun add(row: TimedRfSample) {
        samples.addLast(row)
        val cutoff = row.elapsedMs - KEEP_MS
        while (samples.isNotEmpty() && samples.first().elapsedMs < cutoff) samples.removeFirst()
    }

    fun writeCsv(file: File, rows: List<TimedRfSample>) {
        file.parentFile?.mkdirs()
        file.bufferedWriter().use { out ->
            out.appendLine("epoch_ms,elapsed_ms,kind,status,source,novelty,sustained,sample_rate_hz,rssi_dbm,csi_amplitude,csi_variance,visible_networks,strongest_rssi_dbm,median_rssi_dbm,band24_count,band5_count,band6_count")
            rows.forEach { row ->
                val rf = row.rf
                val survey = row.survey
                out.appendLine(listOf(
                    row.epochMs, row.elapsedMs, if (rf != null) "csi" else "wifi_survey",
                    rf?.status?.name ?: survey?.status.orEmpty(), rf?.source.orEmpty(), rf?.novelty ?: "",
                    rf?.sustainedChange ?: "", rf?.sampleRateHz ?: "", rf?.rssiDbm ?: "", rf?.csiAmplitude ?: "",
                    rf?.csiVariance ?: "", survey?.visibleNetworks ?: "", survey?.strongestRssiDbm ?: "",
                    survey?.medianRssiDbm ?: "", survey?.band24Count ?: "", survey?.band5Count ?: "", survey?.band6Count ?: ""
                ).joinToString(","))
            }
        }
    }

    companion object {
        private const val KEEP_MS = 120_000L
    }
}
