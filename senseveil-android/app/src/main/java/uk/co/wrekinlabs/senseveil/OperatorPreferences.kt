package uk.co.wrekinlabs.senseveil

import android.content.Context

enum class PerformanceMode(
    val label: String,
    /** Phone Wi-Fi survey cadence. Never below 30 s (Android foreground scan budget). */
    val wifiSurveyIntervalMs: Long,
    /** UI refresh cap for RF status. RF frames are still analysed and recorded at full rate. */
    val rfUiRefreshMs: Long
) {
    QUALITY("Quality", 30_000L, 150L),
    BALANCED("Balanced", 45_000L, 250L),
    BATTERY_SAVER("Battery saver", 90_000L, 500L);

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

    /** Advanced override: allow a non-private bridge address. Off by default; RF sensing is a LAN feature. */
    var rfAllowNonLocalHost: Boolean
        get() = prefs.getBoolean(KEY_RF_ALLOW_NON_LOCAL, false)
        set(value) = prefs.edit().putBoolean(KEY_RF_ALLOW_NON_LOCAL, value).apply()

    /** Optional protocol-v2 HMAC key (32 random bytes). When set, plaintext v1 frames are refused. */
    val rfBridgeKey: ByteArray?
        get() = prefs.getString(KEY_RF_V2_KEY, null)
            ?.takeIf { it.matches(Regex("[0-9a-f]{64}")) }
            ?.chunked(2)?.map { it.toInt(16).toByte() }?.toByteArray()

    /** Generates and stores a new v2 key; returns it as hex for entry into the bridge firmware. */
    fun regenerateRfBridgeKey(): String {
        val bytes = ByteArray(32).also { java.security.SecureRandom().nextBytes(it) }
        val hex = bytes.joinToString("") { "%02x".format(it) }
        prefs.edit().putString(KEY_RF_V2_KEY, hex).apply()
        return hex
    }

    fun clearRfBridgeKey() = prefs.edit().remove(KEY_RF_V2_KEY).apply()

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
        private const val KEY_RF_ALLOW_NON_LOCAL = "rf_allow_non_local_host"
        private const val KEY_RF_V2_KEY = "rf_v2_key_hex"
    }
}
