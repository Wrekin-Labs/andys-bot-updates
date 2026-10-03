package uk.co.wrekinlabs.senseveil

import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest

object EvidenceIntegrity {
    fun sha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().buffered().use { input ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
                val read = input.read(buffer)
                if (read <= 0) break
                digest.update(buffer, 0, read)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    fun refreshManifest(bundle: File, appVersion: String) {
        val entries = JSONArray()
        bundle.walkTopDown()
            .filter { it.isFile && it.name != "integrity.json" && it.name != "integrity.sig.json" }
            .sortedBy { it.relativeTo(bundle).path }
            .forEach { file ->
                entries.put(JSONObject().apply {
                    put("path", file.relativeTo(bundle).path.replace('\\', '/'))
                    put("bytes", file.length())
                    put("sha256", sha256(file))
                })
            }

        val manifest = JSONObject().apply {
            put("format", AppSchema.EVIDENCE_FORMAT)
            put("schemaVersion", AppSchema.EVIDENCE_SCHEMA_VERSION)
            put("generatedEpochMs", System.currentTimeMillis())
            put("appVersion", appVersion)
            put("files", entries)
        }
        File(bundle, "integrity.json").writeText(manifest.toString(2))
    }
}
