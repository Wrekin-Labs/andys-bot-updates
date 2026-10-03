package uk.co.wrekinlabs.senseveil

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import java.io.File
import java.io.OutputStream
import java.util.zip.ZipInputStream

data class ImportedEvidenceResult(
    val displayName: String,
    val verification: EvidenceVerificationResult,
    val importedDirectory: File
)

object EvidenceImporter {
    fun importAndVerify(context: Context, uri: Uri): ImportedEvidenceResult {
        val displayName = queryName(context, uri) ?: "imported_evidence"
        val root = File(context.cacheDir, "SenseVeilVerify").apply { mkdirs() }
        val stamp = System.currentTimeMillis()
        val source = File(root, "source_${stamp}_${displayName.replace(Regex("[^A-Za-z0-9._-]"), "_").take(100)}")
        val advertisedSize = querySize(context, uri)
        require(advertisedSize == null || advertisedSize <= MAX_SOURCE_BYTES) { "Evidence file is too large" }
        val extracted = File(root, "bundle_${stamp}_${java.util.UUID.randomUUID()}").apply { mkdirs() }
        val decrypted = File(root, "decrypted_${stamp}_${java.util.UUID.randomUUID()}.zip")
        try {
            context.contentResolver.openInputStream(uri).use { input ->
                requireNotNull(input) { "Cannot open selected evidence" }
                source.outputStream().buffered().use { output -> copyBounded(input, output, MAX_SOURCE_BYTES) }
            }
            val zipSource = if (displayName.endsWith(".sve", ignoreCase = true)) {
                SecureEvidenceVault.decryptFile(source, decrypted)
            } else source
            unzipSafely(zipSource, extracted)
            val verification = EvidenceVerifier.verifyBundle(extracted)
            return ImportedEvidenceResult(displayName, verification, extracted)
        } catch (error: Exception) {
            extracted.deleteRecursively()
            throw error
        } finally {
            source.delete()
            decrypted.delete()
        }
    }

    private fun unzipSafely(zipFile: File, destination: File) {
        val rootPath = destination.canonicalPath + File.separator
        val seen = mutableSetOf<String>()
        var entries = 0
        var totalBytes = 0L
        ZipInputStream(zipFile.inputStream().buffered()).use { zip ->
            while (true) {
                val entry = zip.nextEntry ?: break
                entries++
                require(entries <= MAX_ZIP_ENTRIES) { "Evidence archive contains too many entries" }
                require(!entry.name.startsWith("/") && '\\' !in entry.name && ':' !in entry.name &&
                    entry.name.split('/').none { it == ".." || it == "." }) { "Unsafe ZIP path" }
                val target = File(destination, entry.name).canonicalFile
                require(target.path.startsWith(rootPath)) { "Unsafe ZIP path" }
                require(seen.add(target.path)) { "Duplicate ZIP path" }
                if (entry.isDirectory) {
                    target.mkdirs()
                } else {
                    target.parentFile?.mkdirs()
                    var fileBytes = 0L
                    target.outputStream().buffered().use { output ->
                        val buffer = ByteArray(64 * 1024)
                        while (true) {
                            val read = zip.read(buffer)
                            if (read <= 0) break
                            fileBytes += read
                            totalBytes += read
                            require(fileBytes <= MAX_SINGLE_ENTRY_BYTES) { "Evidence archive entry is too large" }
                            require(totalBytes <= MAX_EXTRACTED_BYTES) { "Evidence archive expands beyond the safety limit" }
                            output.write(buffer, 0, read)
                        }
                    }
                }
                zip.closeEntry()
            }
        }
    }

    private fun copyBounded(input: java.io.InputStream, output: OutputStream, maxBytes: Long) {
        val buffer = ByteArray(64 * 1024)
        var total = 0L
        while (true) {
            val read = input.read(buffer)
            if (read <= 0) break
            total += read
            require(total <= maxBytes) { "Evidence file is too large" }
            output.write(buffer, 0, read)
        }
    }

    private fun queryName(context: Context, uri: Uri): String? {
        return context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) cursor.getString(0) else null
        }
    }

    private fun querySize(context: Context, uri: Uri): Long? {
        return context.contentResolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)?.use { cursor ->
            if (!cursor.moveToFirst() || cursor.isNull(0)) null else cursor.getLong(0)
        }
    }

    private const val MAX_SOURCE_BYTES = 2L * 1024L * 1024L * 1024L
    private const val MAX_EXTRACTED_BYTES = 2L * 1024L * 1024L * 1024L
    private const val MAX_SINGLE_ENTRY_BYTES = 1024L * 1024L * 1024L
    private const val MAX_ZIP_ENTRIES = 512
}
