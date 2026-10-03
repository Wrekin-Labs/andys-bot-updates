package uk.co.wrekinlabs.senseveil

import android.os.SystemClock
import java.util.ArrayDeque

data class ConsensusDecision(
    val candidate: Boolean,
    val sustained: Boolean,
    val positiveFrames: Int,
    val totalFrames: Int,
    val ratio: Float,
    val ageMs: Long,
    val key: String?
)

/**
 * Converts noisy frame-by-frame anomaly candidates into a sustained decision.
 * The gate resets when the candidate identity/reason changes, so unrelated signals
 * cannot accumulate into a false event.
 */
class TemporalConsensusGate {
    private data class Frame(val atMs: Long, val positive: Boolean)

    private val frames = ArrayDeque<Frame>()
    private var activeKey: String? = null
    private var firstPositiveAt: Long? = null

    @Synchronized
    fun update(
        key: String?,
        candidate: Boolean,
        windowFrames: Int,
        requiredPositiveFrames: Int,
        minimumDurationMs: Long,
        nowMs: Long = SystemClock.elapsedRealtime()
    ): ConsensusDecision {
        val previous = frames.peekLast()?.atMs
        if (key != activeKey || key == null ||
            (previous != null && (nowMs < previous || nowMs - previous > 1500L))) {
            frames.clear()
            firstPositiveAt = null
            activeKey = key
        }

        frames.addLast(Frame(nowMs, candidate))
        while (frames.size > windowFrames.coerceAtLeast(1)) frames.removeFirst()

        if (candidate && firstPositiveAt == null) firstPositiveAt = nowMs
        if (!candidate && frames.none { it.positive }) firstPositiveAt = null

        val positives = frames.count { it.positive }
        val total = frames.size
        val ratio = if (total == 0) 0f else positives.toFloat() / total.toFloat()
        val ageMs = firstPositiveAt?.let { (nowMs - it).coerceAtLeast(0L) } ?: 0L
        val sustained = key != null && candidate &&
            positives >= requiredPositiveFrames.coerceAtLeast(1) &&
            ageMs >= minimumDurationMs.coerceAtLeast(0L)

        return ConsensusDecision(
            candidate = candidate,
            sustained = sustained,
            positiveFrames = positives,
            totalFrames = total,
            ratio = ratio,
            ageMs = ageMs,
            key = activeKey
        )
    }

    @Synchronized
    fun reset() {
        frames.clear()
        activeKey = null
        firstPositiveAt = null
    }
}
