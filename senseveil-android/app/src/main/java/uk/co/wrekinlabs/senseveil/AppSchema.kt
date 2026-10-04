package uk.co.wrekinlabs.senseveil

import android.content.Context

data class SchemaMigrationReport(
    val fromVersion: Int,
    val toVersion: Int,
    val changed: Boolean
)

object AppSchema {
    const val SETTINGS_SCHEMA_VERSION = 1
    /**
     * 3 = RC4 (RF/Wi-Fi fields). 4 = RC5: additive only — rfSynthetic, rfAuth, rfAlgorithm in events;
     * rfSynthetic/rfAuth/rfMeasuredRateHz/rfPacketLossPct in session rows; six columns appended to
     * rf_*.csv; wifiVisibleNetworks is null (not 0) when the scan result was unknown.
     * Readers treat every schema-4 field as optional, so schema 1-3 evidence parses unchanged.
     */
    const val EVIDENCE_SCHEMA_VERSION = 4
    const val EVIDENCE_FORMAT = "senseveil-evidence-v1"

    fun migrate(context: Context): SchemaMigrationReport {
        val prefs = context.getSharedPreferences("senseveil_schema", Context.MODE_PRIVATE)
        val from = prefs.getInt("settings_schema", 0)
        if (from < SETTINGS_SCHEMA_VERSION) {
            // v1 establishes explicit schema tracking without changing existing user choices.
            prefs.edit().putInt("settings_schema", SETTINGS_SCHEMA_VERSION).apply()
        }
        return SchemaMigrationReport(from, SETTINGS_SCHEMA_VERSION, from != SETTINGS_SCHEMA_VERSION)
    }
}
