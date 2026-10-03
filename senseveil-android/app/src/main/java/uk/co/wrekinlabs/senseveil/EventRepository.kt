package uk.co.wrekinlabs.senseveil

import android.content.Context
import android.os.Environment
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

data class ScanEvent(
    val timestampEpochMs: Long,
    val type: String,
    val confidence: Int,
    val trackLabel: String?,
    val estimatedDistanceMetres: Float?,
    val magneticMicroTesla: Float?,
    val lightLux: Float?,
    val pressureHpa: Float?,
    val audioDbfs: Float?,
    val note: String = "",
    val anomalyReason: String? = null,
    val profile: String? = null,
    val bundleName: String? = null,
    val sceneQualityPercent: Int? = null,
    val consensusRatio: Float? = null,
    val consensusAgeMs: Long? = null,
    val explanationSummary: String? = null,
    val sessionId: String? = null
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("schemaVersion", AppSchema.EVIDENCE_SCHEMA_VERSION)
        put("timestampEpochMs", timestampEpochMs)
        put("type", type)
        put("confidence", confidence)
        put("trackLabel", trackLabel ?: JSONObject.NULL)
        put("estimatedDistanceMetres", estimatedDistanceMetres ?: JSONObject.NULL)
        put("magneticMicroTesla", magneticMicroTesla ?: JSONObject.NULL)
        put("lightLux", lightLux ?: JSONObject.NULL)
        put("pressureHpa", pressureHpa ?: JSONObject.NULL)
        put("audioDbfs", audioDbfs ?: JSONObject.NULL)
        put("note", note)
        put("anomalyReason", anomalyReason ?: JSONObject.NULL)
        put("profile", profile ?: JSONObject.NULL)
        put("bundleName", bundleName ?: JSONObject.NULL)
        put("sceneQualityPercent", sceneQualityPercent ?: JSONObject.NULL)
        put("consensusRatio", consensusRatio ?: JSONObject.NULL)
        put("consensusAgeMs", consensusAgeMs ?: JSONObject.NULL)
        put("explanationSummary", explanationSummary ?: JSONObject.NULL)
        put("sessionId", sessionId ?: JSONObject.NULL)
    }
}

class EventRepository(private val context: Context) {
    val eventRoot: File by lazy {
        val pictures = context.getExternalFilesDir(Environment.DIRECTORY_PICTURES) ?: context.filesDir
        File(pictures, "SenseVeilEvents").apply { mkdirs() }
    }

    private val logFile: File get() = File(eventRoot, "events.jsonl")

    @Synchronized
    fun append(event: ScanEvent) {
        logFile.appendText(event.toJson().toString() + "\n")
    }

    fun recent(limit: Int = 30): List<ScanEvent> {
        if (!logFile.exists()) return emptyList()
        return logFile.readLines().takeLast(limit).mapNotNull(::parse).reversed()
    }

    fun createEventBundle(reason: String): File {
        val stamp = SimpleDateFormat("yyyyMMdd_HHmmss_SSS", Locale.UK).format(Date())
        val safe = reason.replace(Regex("[^A-Za-z0-9_-]"), "_")
        return File(eventRoot, "Event_${stamp}_$safe").apply { mkdirs() }
    }

    fun newImageFile(reason: String, directory: File = eventRoot): File {
        val stamp = SimpleDateFormat("yyyyMMdd_HHmmss_SSS", Locale.UK).format(Date())
        val safe = reason.replace(Regex("[^A-Za-z0-9_-]"), "_")
        return File(directory, "SV_${stamp}_${safe}.jpg")
    }

    fun newVideoSegmentFile(): File {
        val stamp = SimpleDateFormat("yyyyMMdd_HHmmss_SSS", Locale.UK).format(Date())
        val dir = File(eventRoot, "rolling").apply { mkdirs() }
        return File(dir, "SV_BUF_${stamp}.mp4")
    }

    fun writeBundleMetadata(bundle: File, event: ScanEvent) {
        File(bundle, "event.json").writeText(event.toJson().toString(2))
        EvidenceReport.write(bundle, event)
    }

    fun latestBundle(): File? = eventRoot.listFiles()
        ?.filter { it.isDirectory && it.name.startsWith("Event_") }
        ?.maxByOrNull { it.lastModified() }

    fun exportFileFor(bundle: File): File = File(eventRoot, "exports/${bundle.name}.zip")

    fun secureVaultFileFor(bundle: File): File = File(eventRoot, "vault/${bundle.name}.sve")

    fun shareCacheFileFor(bundle: File): File = File(context.cacheDir, "SenseVeilShare/${bundle.name}.zip")

    private fun parse(line: String): ScanEvent? = try {
        val j = JSONObject(line)
        ScanEvent(
            timestampEpochMs = j.optLong("timestampEpochMs"),
            type = j.optString("type", "event"),
            confidence = j.optInt("confidence"),
            trackLabel = j.optNullableString("trackLabel"),
            estimatedDistanceMetres = j.optFloatOrNull("estimatedDistanceMetres"),
            magneticMicroTesla = j.optFloatOrNull("magneticMicroTesla"),
            lightLux = j.optFloatOrNull("lightLux"),
            pressureHpa = j.optFloatOrNull("pressureHpa"),
            audioDbfs = j.optFloatOrNull("audioDbfs"),
            note = j.optString("note", ""),
            anomalyReason = j.optNullableString("anomalyReason"),
            profile = j.optNullableString("profile"),
            bundleName = j.optNullableString("bundleName"),
            sceneQualityPercent = j.optInt("sceneQualityPercent").takeIf { !j.isNull("sceneQualityPercent") },
            consensusRatio = j.optFloatOrNull("consensusRatio"),
            consensusAgeMs = j.optLong("consensusAgeMs").takeIf { !j.isNull("consensusAgeMs") },
            explanationSummary = j.optNullableString("explanationSummary"),
            sessionId = j.optNullableString("sessionId")
        )
    } catch (_: Throwable) {
        null
    }

    private fun JSONObject.optFloatOrNull(name: String): Float? =
        optDouble(name, Double.NaN).takeIf { !it.isNaN() }?.toFloat()

    private fun JSONObject.optNullableString(name: String): String? =
        optString(name).takeIf { it.isNotBlank() && it != "null" }
}
