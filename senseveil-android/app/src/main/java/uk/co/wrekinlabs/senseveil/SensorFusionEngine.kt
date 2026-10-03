package uk.co.wrekinlabs.senseveil

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.SystemClock
import kotlin.math.abs
import kotlin.math.sqrt

data class SensorSnapshot(
    val magneticMicroTesla: Float? = null,
    val lightLux: Float? = null,
    val accelerationMs2: Float? = null,
    val pressureHpa: Float? = null,
    val audioDbfs: Float? = null,
    val novelty: Float = 0f,
    val available: Set<String> = emptySet()
)

class SensorFusionEngine(
    context: Context,
    private val onUpdate: (SensorSnapshot) -> Unit
) : SensorEventListener {

    private val manager = context.getSystemService(Context.SENSOR_SERVICE) as SensorManager
    private val magnetometer = manager.getDefaultSensor(Sensor.TYPE_MAGNETIC_FIELD)
    private val light = manager.getDefaultSensor(Sensor.TYPE_LIGHT)
    private val accelerometer = manager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
    private val pressure = manager.getDefaultSensor(Sensor.TYPE_PRESSURE)

    private var magnetic: Float? = null
    private var lux: Float? = null
    private var acceleration: Float? = null
    private var pressureValue: Float? = null
    private var audioDbfs: Float? = null

    private var magneticBaseline: Float? = null
    private var lightBaseline: Float? = null
    private var pressureBaseline: Float? = null
    private var audioBaseline: Float? = null
    private var suppressMagnetometerUntil = 0L
    private var running = false

    val availableSensors: Set<String> = buildSet {
        if (magnetometer != null) add("MAG")
        if (light != null) add("LIGHT")
        if (accelerometer != null) add("ACCEL")
        if (pressure != null) add("PRESSURE")
    }

    fun start() {
        if (running) return
        running = true
        listOfNotNull(magnetometer, light, accelerometer, pressure).forEach {
            manager.registerListener(this, it, SensorManager.SENSOR_DELAY_UI)
        }
        emit()
    }

    fun stop() {
        if (!running) return
        running = false
        manager.unregisterListener(this)
    }

    fun setAudioDbfs(value: Float?) {
        audioDbfs = value
        if (value != null) audioBaseline = ema(audioBaseline, value, 0.015f)
        emit()
    }

    fun suppressMagnetometerFor(ms: Long) {
        suppressMagnetometerUntil = SystemClock.elapsedRealtime() + ms
    }

    fun resetBaselines() {
        magneticBaseline = magnetic
        lightBaseline = lux
        pressureBaseline = pressureValue
        audioBaseline = audioDbfs
        emit()
    }

    override fun onSensorChanged(event: SensorEvent) {
        when (event.sensor.type) {
            Sensor.TYPE_MAGNETIC_FIELD -> {
                if (SystemClock.elapsedRealtime() < suppressMagnetometerUntil) return
                magnetic = magnitude(event.values)
                magneticBaseline = ema(magneticBaseline, magnetic!!, 0.015f)
            }
            Sensor.TYPE_LIGHT -> {
                lux = event.values.firstOrNull()
                lux?.let { lightBaseline = ema(lightBaseline, it, 0.012f) }
            }
            Sensor.TYPE_ACCELEROMETER -> acceleration = magnitude(event.values)
            Sensor.TYPE_PRESSURE -> {
                pressureValue = event.values.firstOrNull()
                pressureValue?.let { pressureBaseline = ema(pressureBaseline, it, 0.004f) }
            }
        }
        emit()
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit

    private fun emit() {
        val magNovelty = normalizedDelta(magnetic, magneticBaseline, 20f)
        val lightNovelty = normalizedDelta(lux, lightBaseline, 200f)
        val pressureNovelty = normalizedDelta(pressureValue, pressureBaseline, 2.0f)
        val audioNovelty = normalizedDelta(audioDbfs, audioBaseline, 16f)

        // Keep physical sensor readings secondary to computer vision.
        val novelty = (
            magNovelty * 0.35f +
                lightNovelty * 0.15f +
                pressureNovelty * 0.10f +
                audioNovelty * 0.40f
            ).coerceIn(0f, 1f)

        onUpdate(
            SensorSnapshot(
                magneticMicroTesla = magnetic,
                lightLux = lux,
                accelerationMs2 = acceleration,
                pressureHpa = pressureValue,
                audioDbfs = audioDbfs,
                novelty = novelty,
                available = availableSensors + if (audioDbfs != null) setOf("AUDIO") else emptySet()
            )
        )
    }

    private fun magnitude(values: FloatArray): Float {
        var sum = 0f
        for (v in values) sum += v * v
        return sqrt(sum)
    }

    private fun ema(previous: Float?, value: Float, alpha: Float): Float =
        if (previous == null) value else previous + alpha * (value - previous)

    private fun normalizedDelta(value: Float?, baseline: Float?, scale: Float): Float {
        if (value == null || baseline == null || scale <= 0f) return 0f
        return (abs(value - baseline) / scale).coerceIn(0f, 1f)
    }
}
