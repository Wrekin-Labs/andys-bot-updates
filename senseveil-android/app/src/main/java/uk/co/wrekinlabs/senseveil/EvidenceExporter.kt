package uk.co.wrekinlabs.senseveil

import android.content.Context
import android.content.Intent
import androidx.core.content.FileProvider
import java.io.File
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

object EvidenceExporter {
    fun zipBundle(bundle: File, destination: File): File {
        destination.parentFile?.mkdirs()
        ZipOutputStream(destination.outputStream().buffered()).use { zip ->
            bundle.walkTopDown().filter { it.isFile }.forEach { file ->
                val relative = file.relativeTo(bundle).path.replace('\\', '/')
                zip.putNextEntry(ZipEntry(relative))
                file.inputStream().buffered().use { it.copyTo(zip) }
                zip.closeEntry()
            }
        }
        return destination
    }

    fun shareZip(context: Context, zip: File) {
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", zip)
        val intent = Intent(Intent.ACTION_SEND).apply {
            type = "application/zip"
            putExtra(Intent.EXTRA_STREAM, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        context.startActivity(Intent.createChooser(intent, "Share SenseVeil evidence"))
    }
}
