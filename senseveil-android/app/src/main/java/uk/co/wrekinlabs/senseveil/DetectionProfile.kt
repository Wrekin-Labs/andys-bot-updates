package uk.co.wrekinlabs.senseveil

import android.content.Context

enum class DetectionProfile(
    val label: String,
    val minLandmarks: Int,
    val humanBodyThreshold: Float,
    val disagreementThreshold: Float,
    val visionWeight: Float,
    val faceWeight: Float,
    val fieldWeight: Float,
    val externalWeight: Float,
    val autoCaptureCooldownMs: Long,
    val consensusWindowFrames: Int,
    val consensusRequiredFrames: Int,
    val consensusMinimumDurationMs: Long
) {
    SENSITIVE("Sensitive", 6, 0.24f, 0.46f, 0.70f, 0.08f, 0.08f, 0.14f, 5_000L, 6, 4, 350L),
    BALANCED("Balanced", 8, 0.30f, 0.52f, 0.75f, 0.10f, 0.05f, 0.10f, 8_000L, 8, 6, 600L),
    STRICT("Strict", 10, 0.36f, 0.60f, 0.80f, 0.10f, 0.03f, 0.07f, 12_000L, 10, 8, 900L);

    fun next(): DetectionProfile = entries[(ordinal + 1) % entries.size]
}

class ProfileStore(context: Context) {
    private val prefs = context.getSharedPreferences("senseveil_profile", Context.MODE_PRIVATE)

    var current: DetectionProfile
        get() = runCatching {
            DetectionProfile.valueOf(prefs.getString("profile", DetectionProfile.BALANCED.name)!!)
        }.getOrDefault(DetectionProfile.BALANCED)
        set(value) { prefs.edit().putString("profile", value.name).apply() }
}
