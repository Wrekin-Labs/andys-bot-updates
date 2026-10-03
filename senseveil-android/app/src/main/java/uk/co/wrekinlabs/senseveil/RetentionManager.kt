package uk.co.wrekinlabs.senseveil

import android.content.Context
import java.io.File

class RetentionManager(private val context: Context, private val preferences: SecurityPreferences) {
    fun run(eventRoot: File): RetentionResult {
        val now = System.currentTimeMillis()
        val result = EvidenceRetention.prune(eventRoot,
            now - preferences.retentionDays * DAY_MS,
            preferences.maxEvidenceMb.toLong() * 1024L * 1024L,
            CaptureProgress::isPending)
        var deleted = result.deletedItems
        var freed = result.freedBytes

        File(eventRoot, "rolling")
            .takeIf { it.exists() }
            ?.listFiles()
            ?.filter { it.isFile && now - it.lastModified() > ROLLING_ORPHAN_MAX_AGE_MS }
            ?.forEach { clip ->
                val bytes = clip.length()
                if (clip.delete()) {
                    deleted++
                    freed += bytes
                }
            }

        File(context.cacheDir, "SenseVeilShare")
            .takeIf { it.exists() }
            ?.listFiles()
            ?.filter { now - it.lastModified() > SHARE_CACHE_MAX_AGE_MS }
            ?.forEach { it.deleteRecursively() }

        return RetentionResult(deleted, freed, EvidenceRetention.size(eventRoot))
    }

    companion object {
        private const val DAY_MS = 24L * 60L * 60L * 1000L
        private const val SHARE_CACHE_MAX_AGE_MS = DAY_MS
        private const val ROLLING_ORPHAN_MAX_AGE_MS = DAY_MS
    }
}
