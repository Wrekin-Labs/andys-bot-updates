package uk.co.wrekinlabs.senseveil

import org.json.JSONObject
import java.io.File

/** Validates every file, including unsigned additions. Never follows paths outside a bundle. */
object EvidenceManifest {
    data class Result(val checked: Int, val failures: List<String>)
    private val controls = setOf("integrity.json", "integrity.sig.json")

    fun check(bundle: File, manifest: JSONObject): Result {
        val failures = mutableListOf<String>()
        val root = bundle.canonicalFile
        val files = manifest.optJSONArray("files")
            ?: return Result(0, listOf("Manifest files array missing"))
        if (files.length() == 0 || files.length() > 512) return Result(0, listOf("Invalid manifest file count"))
        val listed = mutableSetOf<String>()
        var checked = 0
        for (i in 0 until files.length()) {
            val row = files.optJSONObject(i)
            if (row == null) { failures += "Invalid manifest row $i"; continue }
            val path = row.optString("path")
            val components = path.split('/')
            if (path.isBlank() || '\\' in path || ':' in path ||
                components.any { it.isEmpty() || it == "." || it == ".." } || path in controls) {
                failures += "Unsafe manifest path"; continue
            }
            if (!listed.add(path)) { failures += "$path duplicate"; continue }
            val file = File(root, path).canonicalFile
            if (!file.path.startsWith(root.path + File.separator)) {
                failures += "$path outside bundle"; continue
            }
            val expected = row.optString("sha256")
            if (!expected.matches(Regex("[0-9a-fA-F]{64}"))) { failures += "$path invalid SHA-256"; continue }
            checked++
            when {
                !file.isFile -> failures += "$path missing"
                row.has("bytes") && row.optLong("bytes", -1) != file.length() -> failures += "$path size mismatch"
                !EvidenceIntegrity.sha256(file).equals(expected, true) -> failures += "$path hash mismatch"
            }
        }
        root.walkTopDown().filter { it.isFile }.forEach { file ->
            val relative = file.relativeTo(root).invariantSeparatorsPath
            if (relative !in controls && relative !in listed) failures += "$relative not signed by manifest"
        }
        return Result(checked, failures)
    }
}
