package uk.co.wrekinlabs.senseveil

import android.content.Context

object FirstRunGuide {
    private const val PREFS = "senseveil_first_run"
    private const val KEY_SEEN_VERSION = "guide_seen_version"

    fun shouldShow(context: Context): Boolean =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getInt(KEY_SEEN_VERSION, 0) < AppSchema.SETTINGS_SCHEMA_VERSION

    fun markSeen(context: Context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putInt(KEY_SEEN_VERSION, AppSchema.SETTINGS_SCHEMA_VERSION).apply()
    }

    fun text(): String = buildString {
        append("1. Hold the phone steady and tap CALIBRATE FIELD BASELINES.\n\n")
        append("2. Start with BALANCED detection. Sensitive reacts sooner; Strict requires stronger evidence.\n\n")
        append("3. Camera AI, field sensors and optional external radar are independent measurements. ")
        append("An anomaly means the configured detectors disagree or corroborate unusually; it does not identify a paranormal cause.\n\n")
        append("4. Audio monitoring is opt-in. Location is not required for scanning.\n\n")
        append("5. Use SELF-TEST before an important session and VERIFY LAST EVIDENCE after capture.\n\n")
        append("6. Through-wall presence requires compatible external radar hardware. The phone camera cannot see through walls.")
    }
}
