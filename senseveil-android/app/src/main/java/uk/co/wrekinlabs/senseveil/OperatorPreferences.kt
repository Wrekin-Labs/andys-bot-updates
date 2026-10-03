package uk.co.wrekinlabs.senseveil

import android.content.Context

enum class PerformanceMode(val label: String) {
    QUALITY("Quality"),
    BALANCED("Balanced"),
    BATTERY_SAVER("Battery saver");

    fun next(): PerformanceMode = entries[(ordinal + 1) % entries.size]
}

class OperatorPreferences(context: Context) {
    init { AppSchema.migrate(context) }

    private val prefs = context.getSharedPreferences("senseveil_operator", Context.MODE_PRIVATE)

    var autoCaptureEnabled: Boolean
        get() = prefs.getBoolean(KEY_AUTO_CAPTURE, true)
        set(value) = prefs.edit().putBoolean(KEY_AUTO_CAPTURE, value).apply()

    var performanceMode: PerformanceMode
        get() = runCatching { PerformanceMode.valueOf(prefs.getString(KEY_PERFORMANCE, PerformanceMode.BALANCED.name)!!) }
            .getOrDefault(PerformanceMode.BALANCED)
        set(value) = prefs.edit().putString(KEY_PERFORMANCE, value.name).apply()

    companion object {
        private const val KEY_AUTO_CAPTURE = "auto_capture"
        private const val KEY_PERFORMANCE = "performance_mode"
    }
}
