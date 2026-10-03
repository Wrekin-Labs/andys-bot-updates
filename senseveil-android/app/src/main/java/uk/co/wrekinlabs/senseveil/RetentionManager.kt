package uk.co.wrekinlabs.senseveil

import android.content.Context
import java.io.File

data class RetentionResult(
    val deletedItems: Int,
    val freedBytes: Long,
    val remainingBytes: Long
)

class RetentionManager(private val context: Context, private val preferences: SecurityPreferences) {
    fun run(eventRoot: File): RetentionResult {
        var deleted = 0
        var freed = 0L
        val now = System.currentTimeMillis()
        val cutoff = now - preferences.retentionDays * DAY_MS

        retentionCandidates(eventRoot)
            .filter { it.lastModified() < cutoff }
            .forEach { item ->
                val bytes = item.sizeRecursive()
                if (item.deleteRecursively()) {
                    deleted++
                    freed += bytes
                }
            }

        val limitBytes = preferences.maxEvidenceMb.toLong() * 1024L * 1024L
        var total = eventRoot.sizeRecursive()
        storageCandidates(eventRoot).forEach { item ->
            if (total <= limitBytes) return@forEach
            val bytes = item.sizeRecursive()
            if (item.deleteRecursively()) {
                deleted++
                freed += bytes
                total = (total - bytes).coerceAtLeast(0L)
            }
        }

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

        return RetentionResult(deleted, freed, eventRoot.sizeRecursive())
    }

    /**
     * One candidate represents one independently disposable evidence item. Event bundles are
     * candidates as directories so a quota cleanup never leaves half an event behind.
     */
    private fun retentionCandidates(eventRoot: File): List<File> {
        val eventBundles = eventRoot.listFiles().orEmpty()
            .filter { it.isDirectory && it.name.startsWith("Event_") }
        val archives = listOf("vault", "exports")
            .flatMap { dir -> File(eventRoot, dir).listFiles().orEmpty().toList() }
            .filter { it.isFile && (it.extension.equals("sve", true) || it.extension.equals("zip", true)) }
        return (eventBundles + archives).distinctBy { it.absolutePath }
    }

    private fun storageCandidates(eventRoot: File): List<File> =
        retentionCandidates(eventRoot).sortedBy { it.lastModified() }

    private fun File.sizeRecursive(): Long = when {
        isFile -> length()
        isDirectory -> listFiles()?.sumOf { it.sizeRecursive() } ?: 0L
        else -> 0L
    }

    companion object {
        private const val DAY_MS = 24L * 60L * 60L * 1000L
        private const val SHARE_CACHE_MAX_AGE_MS = DAY_MS
        private const val ROLLING_ORPHAN_MAX_AGE_MS = DAY_MS
    }
}
