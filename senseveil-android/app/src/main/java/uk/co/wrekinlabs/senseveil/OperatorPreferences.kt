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

    var wifiSurveyEnabled: Boolean
        get() = prefs.getBoolean(KEY_WIFI_SURVEY, false)
        set(value) = prefs.edit().putBoolean(KEY_WIFI_SURVEY, value).apply()

    var rfBridgeEnabled: Boolean
        get() = prefs.getBoolean(KEY_RF_BRIDGE, false)
        set(value) = prefs.edit().putBoolean(KEY_RF_BRIDGE, value).apply()

    var rfBridgeHost: String
        get() = prefs.getString(KEY_RF_HOST, "192.168.4.1") ?: "192.168.4.1"
        set(value) = prefs.edit().putString(KEY_RF_HOST, value.trim().take(255)).apply()

    var rfBridgePort: Int
        get() = prefs.getInt(KEY_RF_PORT, 8765).coerceIn(1, 65535)
        set(value) = prefs.edit().putInt(KEY_RF_PORT, value.coerceIn(1, 65535)).apply()

    val rfPairCode: String
        get() {
            val existing = prefs.getString(KEY_RF_PAIR, null)?.takeIf { it.length >= 12 }
            if (existing != null) return existing
            val generated = java.util.UUID.randomUUID().toString().replace("-", "").take(20)
            prefs.edit().putString(KEY_RF_PAIR, generated).apply()
            return generated
        }

    fun regenerateRfPairCode(): String {
        val generated = java.util.UUID.randomUUID().toString().replace("-", "").take(20)
        prefs.edit().putString(KEY_RF_PAIR, generated).apply()
        return generated
    }

    companion object {
        private const val KEY_AUTO_CAPTURE = "auto_capture"
        private const val KEY_PERFORMANCE = "performance_mode"
        private const val KEY_WIFI_SURVEY = "wifi_survey_enabled"
        private const val KEY_RF_BRIDGE = "rf_bridge_enabled"
        private const val KEY_RF_HOST = "rf_bridge_host"
        private const val KEY_RF_PORT = "rf_bridge_port"
        private const val KEY_RF_PAIR = "rf_pair_code"
    }
}
