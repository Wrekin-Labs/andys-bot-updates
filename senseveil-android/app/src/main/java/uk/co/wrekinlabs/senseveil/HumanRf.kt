package uk.co.wrekinlabs.senseveil

import java.util.ArrayDeque

enum class HumanRfState {
    OFF,
    CALIBRATING,
    UNAVAILABLE,
    QUIET,
    MOTION_LIKE_VARIATION,
    HUMAN_COMPATIBLE_MOTION,
    ENVIRONMENT_CHANGE,
    SYNTHETIC_TEST
}

data class HumanRfReading(
    val state: HumanRfState = HumanRfState.OFF,
    val patternConfidence: Float = 0f,
    val sampleCount: Int = 0,
    val windowMs: Long = 0L,
    val reason: String = "Human RF research mode off",
    val algorithm: String = HumanRfInterpreter.ALGORITHM,
    val researchOnly: Boolean = true
)

/**
 * Experimental interpretation layer over the hardened RC5 RF channel.
 *
 * This intentionally does NOT feed FusionScorer/person confidence. It classifies
 * human-compatible motion patterns only when CSI plus another RF channel are
 * available at an acceptable rate/loss level. Doors, fans, pets, moving access
 * points and multipath changes can produce the same result.
 */
class HumanRfInterpreter(
    private val historyMs: Long = DEFAULT_HISTORY_MS
) {
    private data class Sample(
        val atMs: Long,
        val novelty: Float,
        val sustained: Boolean,
        val suitable: Boolean
    )

    private val samples = ArrayDeque<Sample>()
    private var lastAtMs = Long.MIN_VALUE

    fun reset() {
        samples.clear()
        lastAtMs = Long.MIN_VALUE
    }

    @Synchronized
    fun accept(rf: WifiRfReading, enabled: Boolean, nowMs: Long = rf.epochMs): HumanRfReading {
        if (!enabled) {
            reset()
            return HumanRfReading()
        }

        if (lastAtMs != Long.MIN_VALUE && nowMs + CLOCK_BACKWARD_RESET_MS < lastAtMs) {
            samples.clear()
        }
        lastAtMs = nowMs

        when (rf.status) {
            WifiRfStatus.OFF -> {
                samples.clear()
                return HumanRfReading(HumanRfState.OFF, reason = "RF bridge off")
            }
            WifiRfStatus.CONNECTING, WifiRfStatus.CALIBRATING -> {
                samples.clear()
                return HumanRfReading(
                    HumanRfState.CALIBRATING,
                    sampleCount = rf.baselineSamples,
                    reason = "Waiting for a stationary RF baseline"
                )
            }
            WifiRfStatus.PAUSED_MOVING -> {
                samples.clear()
                return HumanRfReading(HumanRfState.UNAVAILABLE, reason = "Phone movement pauses Human RF mode")
            }
            WifiRfStatus.UNAVAILABLE, WifiRfStatus.STALE -> {
                samples.clear()
                return HumanRfReading(HumanRfState.UNAVAILABLE, reason = rf.message)
            }
            WifiRfStatus.READY, WifiRfStatus.RF_CHANGE -> Unit
        }

        val channels = listOf(rf.rssiDbm, rf.csiAmplitude, rf.csiVariance).count { it != null }
        val csiChannels = listOf(rf.csiAmplitude, rf.csiVariance).count { it != null }
        val rate = rf.measuredRateHz ?: rf.sampleRateHz ?: 0f
        val loss = rf.packetLossPercent ?: 0f
        val suitable = channels >= MIN_TOTAL_CHANNELS &&
            csiChannels >= MIN_CSI_CHANNELS &&
            rate >= MIN_RATE_HZ &&
            loss <= MAX_PACKET_LOSS_PERCENT

        samples.addLast(Sample(nowMs, rf.novelty.coerceIn(0f, 1f), rf.sustainedChange, suitable))
        val cutoff = nowMs - historyMs
        while (samples.isNotEmpty() && samples.first().atMs < cutoff) samples.removeFirst()

        val span = if (samples.size >= 2) (samples.last().atMs - samples.first().atMs).coerceAtLeast(0L) else 0L
        val peak = samples.maxOfOrNull { it.novelty } ?: 0f
        val activeRatio = if (samples.isEmpty()) 0f else samples.count { it.novelty >= VARIATION_NOVELTY } / samples.size.toFloat()
        val suitableRatio = if (samples.isEmpty()) 0f else samples.count { it.suitable } / samples.size.toFloat()

        val underlying = when {
            rf.status == WifiRfStatus.RF_CHANGE && rf.sustainedChange && suitable -> {
                val quality = qualityScore(rate, loss, channels)
                val confidence = (0.30f + 0.50f * rf.novelty + 0.20f * quality).coerceIn(0f, MAX_PATTERN_CONFIDENCE)
                HumanRfReading(
                    HumanRfState.HUMAN_COMPATIBLE_MOTION,
                    confidence,
                    samples.size,
                    span,
                    "Sustained multi-channel CSI/RF change compatible with human movement; not proof of a person"
                )
            }
            rf.status == WifiRfStatus.RF_CHANGE || rf.sustainedChange -> HumanRfReading(
                HumanRfState.ENVIRONMENT_CHANGE,
                (0.20f + 0.45f * rf.novelty).coerceIn(0f, 0.60f),
                samples.size,
                span,
                if (!suitable)
                    "Strong RF change, but signal quality/channel diversity is insufficient for Human RF interpretation"
                else
                    "Strong environmental RF change"
            )
            suitable &&
                samples.size >= MIN_WINDOW_SAMPLES &&
                span >= MIN_WINDOW_SPAN_MS &&
                peak >= MOTION_LIKE_PEAK &&
                activeRatio >= MIN_ACTIVE_RATIO &&
                suitableRatio >= MIN_SUITABLE_RATIO -> HumanRfReading(
                    HumanRfState.MOTION_LIKE_VARIATION,
                    (0.20f + 0.45f * peak + 0.15f * activeRatio).coerceIn(0f, 0.65f),
                    samples.size,
                    span,
                    "Multi-channel RF variation is motion-like but has not crossed the sustained-change gate"
                )
            else -> HumanRfReading(
                HumanRfState.QUIET,
                0f,
                samples.size,
                span,
                if (suitable) "No sustained human-compatible RF motion pattern" else "RF available; CSI/channel quality not sufficient for Human RF interpretation"
            )
        }

        return if (rf.synthetic) {
            underlying.copy(
                state = HumanRfState.SYNTHETIC_TEST,
                patternConfidence = minOf(underlying.patternConfidence, 0.50f),
                reason = "Synthetic bridge test only — simulated outcome: " + underlying.state.name + ". Not real presence evidence."
            )
        } else underlying
    }

    private fun qualityScore(rateHz: Float, lossPercent: Float, channels: Int): Float {
        val rate = ((rateHz - MIN_RATE_HZ) / 16f).coerceIn(0f, 1f)
        val loss = (1f - lossPercent / MAX_PACKET_LOSS_PERCENT).coerceIn(0f, 1f)
        val diversity = ((channels - 1) / 2f).coerceIn(0f, 1f)
        return (0.40f * rate + 0.35f * loss + 0.25f * diversity).coerceIn(0f, 1f)
    }

    companion object {
        const val ALGORITHM = "human-rf-pattern-v1"
        const val DEFAULT_HISTORY_MS = 6_000L
        const val MIN_RATE_HZ = 4f
        const val MAX_PACKET_LOSS_PERCENT = 30f
        const val MIN_TOTAL_CHANNELS = 2
        const val MIN_CSI_CHANNELS = 1
        const val MIN_WINDOW_SAMPLES = 8
        const val MIN_WINDOW_SPAN_MS = 800L
        const val VARIATION_NOVELTY = 0.20f
        const val MOTION_LIKE_PEAK = 0.45f
        const val MIN_ACTIVE_RATIO = 0.25f
        const val MIN_SUITABLE_RATIO = 0.75f
        const val MAX_PATTERN_CONFIDENCE = 0.90f
        const val CLOCK_BACKWARD_RESET_MS = 1_000L
    }
}
