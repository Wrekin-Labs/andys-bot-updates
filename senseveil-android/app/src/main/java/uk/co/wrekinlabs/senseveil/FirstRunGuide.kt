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
        append("5. Tap CAPTURE once. Saving includes a 10-second post-event window and may take 30 seconds while video finishes. Open EVENTS, wait for Sealed, then choose VERIFY on that capture. REVIEW shows the photo and readings; SHARE checks integrity before opening the Android share menu.\n\n")
        append("6. FIELD shows a simple tracking outline. LAB adds skeletons, object boxes and detailed scores. These scores are heuristic support, not calibrated probabilities.\n\n")
        append("7. LAB may show a rough adult shoulder-size range estimate for a visible, frontal pose. It assumes an average adult and camera angle: children, unusual lenses, crop and posture can make it wrong. It is not measured distance. The vision map shows direction only.\n\n")
        append("8. Through-wall presence requires compatible external radar hardware. The phone camera cannot see through walls.\n\n")
        append("9. SHARE exports a readable ZIP. When Secure Vault is on, a separate encrypted SVE copy stays on this device. Export evidence you need before uninstalling or clearing app data; that also removes the device's encryption keys.")
    }
}
