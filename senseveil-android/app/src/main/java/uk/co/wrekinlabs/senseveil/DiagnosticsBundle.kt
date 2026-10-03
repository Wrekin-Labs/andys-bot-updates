package uk.co.wrekinlabs.senseveil

import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

object DiagnosticsBundle {
    fun create(context: Context, operator: OperatorPreferences, security: SecurityPreferences): File {
        val root = File(context.cacheDir, "SenseVeilDiagnosticsExport").apply { mkdirs() }
        val zipFile = File(root, "SenseVeil_Diagnostics_${System.currentTimeMillis()}.zip")
        val diagnostics = JSONObject().apply {
            put("schemaVersion", AppSchema.SETTINGS_SCHEMA_VERSION)
            put("appVersion", Brand.VERSION)
            put("generatedEpochMs", System.currentTimeMillis())
            put("androidRelease", Build.VERSION.RELEASE)
            put("api", Build.VERSION.SDK_INT)
            put("device", "${Build.MANUFACTURER} ${Build.MODEL}")
            put("autoCapture", operator.autoCaptureEnabled)
            put("performanceMode", operator.performanceMode.name)
            put("secureVault", security.secureVaultEnabled)
            put("retentionDays", security.retentionDays)
            put("privacy", "Diagnostics intentionally exclude camera images/video, evidence bundles, raw microphone audio and location.")
        }
        ZipOutputStream(zipFile.outputStream().buffered()).use { zip ->
            addText(zip, "diagnostics.json", diagnostics.toString(2))
            addText(zip, "capabilities.txt", DeviceCapabilities.inspect(context).asText())
            addText(zip, "crash_summary.txt", CrashDiagnostics.lastCrashSummary(context))
            CrashDiagnostics.lastCrashFile(context).takeIf { it.exists() }?.let { file ->
                zip.putNextEntry(ZipEntry("last_crash.json"))
                file.inputStream().buffered().use { it.copyTo(zip) }
                zip.closeEntry()
            }
        }
        return zipFile
    }

    fun share(context: Context, zip: File) {
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", zip)
        val intent = Intent(Intent.ACTION_SEND).apply {
            type = "application/zip"
            putExtra(Intent.EXTRA_STREAM, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        context.startActivity(Intent.createChooser(intent, "Share SenseVeil diagnostics"))
    }

    private fun addText(zip: ZipOutputStream, name: String, text: String) {
        zip.putNextEntry(ZipEntry(name))
        zip.write(text.toByteArray(Charsets.UTF_8))
        zip.closeEntry()
    }
}
