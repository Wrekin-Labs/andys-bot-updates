package uk.co.wrekinlabs.senseveil

import android.content.Context

class SecurityPreferences(context: Context) {
    private val prefs = context.getSharedPreferences("senseveil_security", Context.MODE_PRIVATE)

    var secureVaultEnabled: Boolean
        get() = prefs.getBoolean(KEY_SECURE_VAULT, true)
        set(value) = prefs.edit().putBoolean(KEY_SECURE_VAULT, value).apply()

    var retentionDays: Int
        get() = prefs.getInt(KEY_RETENTION_DAYS, 30).coerceIn(1, 365)
        set(value) = prefs.edit().putInt(KEY_RETENTION_DAYS, value.coerceIn(1, 365)).apply()

    var maxEvidenceMb: Int
        get() = prefs.getInt(KEY_MAX_EVIDENCE_MB, 2048).coerceIn(128, 32768)
        set(value) = prefs.edit().putInt(KEY_MAX_EVIDENCE_MB, value.coerceIn(128, 32768)).apply()

    companion object {
        private const val KEY_SECURE_VAULT = "secure_vault"
        private const val KEY_RETENTION_DAYS = "retention_days"
        private const val KEY_MAX_EVIDENCE_MB = "max_evidence_mb"
    }
}
