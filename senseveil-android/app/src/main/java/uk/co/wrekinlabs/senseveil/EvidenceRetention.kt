package uk.co.wrekinlabs.senseveil

import java.io.File

data class RetentionResult(val deletedItems: Int, val freedBytes: Long, val remainingBytes: Long)

/** Delete whole expired/over-quota items; active producers always win over housekeeping. */
object EvidenceRetention {
    fun prune(root: File, cutoff: Long, limitBytes: Long, protected: (String) -> Boolean): RetentionResult {
        var deleted = 0
        var freed = 0L
        fun candidates(): List<File> {
            val bundles = root.listFiles().orEmpty().filter { it.isDirectory && it.name.startsWith("Event_") }
            val archives = listOf("vault", "exports").flatMap { File(root, it).listFiles().orEmpty().toList() }
                .filter { it.isFile && it.extension.lowercase() in setOf("zip", "sve") }
            return (bundles + archives).filterNot {
                protected(if (it.isDirectory) it.name else it.nameWithoutExtension)
            }.sortedBy { it.lastModified() }
        }
        fun remove(item: File) {
            val bytes = size(item)
            if (item.deleteRecursively()) { deleted++; freed += bytes }
        }
        candidates().filter { it.lastModified() < cutoff }.forEach(::remove)
        var total = size(root)
        for (item in candidates()) {
            if (total <= limitBytes) break
            val before = freed
            remove(item)
            total = (total - (freed - before)).coerceAtLeast(0L)
        }
        return RetentionResult(deleted, freed, size(root))
    }

    fun size(file: File): Long = when {
        file.isFile -> file.length()
        file.isDirectory -> file.listFiles().orEmpty().sumOf(::size)
        else -> 0L
    }
}
