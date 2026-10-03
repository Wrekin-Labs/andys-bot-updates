package uk.co.wrekinlabs.senseveil

import android.content.Context

enum class AlertMode(val label: String) {
    SILENT("Silent"),
    HAPTIC("Haptic"),
    STRONG_HAPTIC("Strong haptic");

    fun next(): AlertMode = entries[(ordinal + 1) % entries.size]
}

class AlertPolicyStore(context: Context) {
    private val prefs = context.getSharedPreferences("senseveil_alerts", Context.MODE_PRIVATE)

    var mode: AlertMode
        get() = runCatching {
            AlertMode.valueOf(prefs.getString("mode", AlertMode.HAPTIC.name)!!)
        }.getOrDefault(AlertMode.HAPTIC)
        set(value) { prefs.edit().putString("mode", value.name).apply() }
}
