package uk.co.wrekinlabs.senseveil

class ExternalSensorReplayGuard {
    data class Decision(val accepted: Boolean, val reason: String)

    private data class State(var sequence: Long? = null, var sensorEpochMs: Long? = null)
    private val bySource = mutableMapOf<String, State>()

    @Synchronized
    fun check(reading: ExternalPresenceReading, nowEpochMs: Long = System.currentTimeMillis()): Decision {
        if (!reading.confidence.isFinite() || reading.confidence !in 0f..1f ||
            reading.distanceMetres?.let { !it.isFinite() || it < 0f } == true ||
            reading.sensorSequence?.let { it < 0L } == true ||
            reading.sensorEpochMs?.let { it < 0L } == true) return Decision(false, "invalid sensor values")
        val source = "${reading.sensorType}:${reading.source}"
        val state = bySource[source] ?: State()
        if (source !in bySource && bySource.size >= 128) return Decision(false, "sensor source limit reached")
        if (state.sequence != null && reading.sensorSequence == null) return Decision(false, "sensor sequence missing")
        if (state.sensorEpochMs != null && reading.sensorEpochMs == null) return Decision(false, "sensor timestamp missing")

        reading.sensorEpochMs?.let { ts ->
            if (ts > nowEpochMs && ts - nowEpochMs > MAX_FUTURE_MS) return Decision(false, "sensor timestamp is too far in the future")
            if (ts < nowEpochMs && nowEpochMs - ts > MAX_AGE_MS) return Decision(false, "sensor packet is stale")
            val previous = state.sensorEpochMs
            if (previous != null && ts < previous && previous - ts > MAX_OUT_OF_ORDER_MS) {
                return Decision(false, "sensor timestamp moved backwards")
            }
        }

        reading.sensorSequence?.let { seq ->
            val previous = state.sequence
            if (previous != null && seq <= previous) return Decision(false, "duplicate or replayed sensor sequence")
        }

        reading.sensorSequence?.let { state.sequence = it }
        reading.sensorEpochMs?.let { state.sensorEpochMs = maxOf(state.sensorEpochMs ?: it, it) }
        bySource[source] = state
        return Decision(true, "accepted")
    }

    @Synchronized
    fun reset() = bySource.clear()

    companion object {
        const val MAX_FUTURE_MS = 5_000L
        const val MAX_AGE_MS = 15_000L
        const val MAX_OUT_OF_ORDER_MS = 2_000L
    }
}
