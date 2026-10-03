package uk.co.wrekinlabs.senseveil

import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

data class EvidenceCatalogEntry(
    val bundle: File,
    val timestampEpochMs: Long?,
    val type: String,
    val confidence: Int?,
    val trackLabel: String?,
    val profile: String?,
    val hasImage: Boolean,
    val hasVideo: Boolean,
    val hasIntegrity: Boolean,
    val hasSignature: Boolean,
    val hasVaultArchive: Boolean
) {
    fun oneLine(): String {
        val stamp = timestampEpochMs?.let {
            SimpleDateFormat("dd MMM HH:mm:ss", Locale.UK).format(Date(it))
        } ?: bundle.name.removePrefix("Event_").take(19)
        val score = confidence?.let { " $it%" }.orEmpty()
        val track = trackLabel?.let { " $it" }.orEmpty()
        val flags = buildList {
            if (hasImage) add("IMG")
            if (hasVideo) add("VID")
            if (hasIntegrity) add("HASH")
            if (hasSignature) add("SIG")
            if (hasVaultArchive) add("VAULT")
        }.joinToString("/")
        return "$stamp • ${type.uppercase()}$score$track • ${profile ?: "--"} • $flags"
    }
}

object EvidenceCatalog {
    fun recent(eventRoot: File, limit: Int = 12): List<EvidenceCatalogEntry> =
        eventRoot.listFiles().orEmpty()
            .filter { it.isDirectory && it.name.startsWith("Event_") }
            .sortedByDescending { it.lastModified() }
            .take(limit)
            .map(::readEntry)

    fun render(eventRoot: File, limit: Int = 12): String {
        val entries = recent(eventRoot, limit)
        if (entries.isEmpty()) return "No saved evidence events yet."
        return buildString {
            append("RECENT EVIDENCE ").append(entries.size).append('\n')
            entries.forEachIndexed { index, entry ->
                append(index + 1).append(". ").append(entry.oneLine()).append('\n')
            }
            append("\nSIG means a device-key signature envelope exists. Use Verify Last/Imported Evidence to validate it; catalog presence alone is not verification.")
        }
    }

    private fun readEntry(bundle: File): EvidenceCatalogEntry {
        val eventJson = File(bundle, "event.json")
        val metadata = runCatching { JSONObject(eventJson.readText()) }.getOrNull()
        val image = bundle.walkTopDown().any { it.isFile && it.extension.equals("jpg", true) }
        val video = bundle.walkTopDown().any { it.isFile && it.extension.equals("mp4", true) }
        val vault = File(bundle.parentFile, "vault/${bundle.name}.sve")
        return EvidenceCatalogEntry(
            bundle = bundle,
            timestampEpochMs = metadata?.optLong("timestampEpochMs")?.takeIf { it > 0L },
            type = metadata?.optString("type")?.takeIf { it.isNotBlank() } ?: "event",
            confidence = metadata?.let { m -> m.optInt("confidence").takeIf { m.has("confidence") } },
            trackLabel = metadata?.optString("trackLabel")?.takeIf { it.isNotBlank() && it != "null" },
            profile = metadata?.optString("profile")?.takeIf { it.isNotBlank() && it != "null" },
            hasImage = image,
            hasVideo = video,
            hasIntegrity = File(bundle, "integrity.json").exists(),
            hasSignature = File(bundle, "integrity.sig.json").exists(),
            hasVaultArchive = vault.exists()
        )
    }
}
