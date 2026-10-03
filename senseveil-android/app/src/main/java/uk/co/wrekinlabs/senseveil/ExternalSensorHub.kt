package uk.co.wrekinlabs.senseveil

/**
 * External non-line-of-sight sensors connect here.
 * A phone camera cannot see through a wall. Compatible radar/ranging hardware can publish
 * presence/range readings over BLE or USB without changing the scanner or evidence layers.
 */
enum class ExternalSensorType { RADAR, THERMAL, DEPTH, RANGING }

data class ExternalPresenceReading(
    val detected: Boolean,
    val confidence: Float,
    val distanceMetres: Float?,
    val lateralOffset: Float? = null,
    val source: String,
    val temperatureCelsius: Float? = null,
    val radialVelocityMetresPerSecond: Float? = null,
    val sensorType: ExternalSensorType = ExternalSensorType.RADAR,
    val receivedEpochMs: Long = System.currentTimeMillis(),
    val sensorSequence: Long? = null,
    val sensorEpochMs: Long? = null
)

interface ExternalSensorHub {
    val label: String
    val capabilities: Set<ExternalSensorType>
    fun start(onReading: (ExternalPresenceReading) -> Unit)
    fun stop()
}

class NoExternalSensorHub : ExternalSensorHub {
    override val label = "Radar / thermal: not connected"
    override val capabilities: Set<ExternalSensorType> = emptySet()
    override fun start(onReading: (ExternalPresenceReading) -> Unit) = Unit
    override fun stop() = Unit
}
