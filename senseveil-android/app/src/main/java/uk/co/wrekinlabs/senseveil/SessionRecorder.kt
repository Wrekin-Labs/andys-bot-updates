package uk.co.wrekinlabs.senseveil

import android.content.Context
import android.os.SystemClock
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class SessionRecorder(private val context: Context) {
    private val root: File by lazy {
        File(context.getExternalFilesDir(null) ?: context.filesDir, "SenseVeilSessions").apply { mkdirs() }
    }

    private var sessionDir: File? = null
    private var timelineFile: File? = null
    private var startedEpochMs: Long = 0L
    private var lastWriteElapsedMs: Long = 0L
    private var frameCount = 0
    private var anomalyCount = 0
    private var previousChainHash = SessionChain.GENESIS
    private var stopped = false

    val currentSessionId: String?
        get() = sessionDir?.name

    @Synchronized
    fun start() {
        if (sessionDir != null) return
        stopped = false
        startedEpochMs = System.currentTimeMillis()
        previousChainHash = SessionChain.GENESIS
        val stamp = SimpleDateFormat("yyyyMMdd_HHmmss", Locale.UK).format(Date(startedEpochMs))
        sessionDir = File(root, "Session_${stamp}_${java.util.UUID.randomUUID().toString().take(8)}").apply { mkdirs() }
        ActiveSessions.opened(sessionDir!!.name)
        timelineFile = File(sessionDir, "timeline.jsonl")
        writeJsonAtomically(
            File(sessionDir, "session.json"),
            JSONObject().apply {
                put("schemaVersion", AppSchema.EVIDENCE_SCHEMA_VERSION)
                put("sessionId", sessionDir!!.name)
                put("startedEpochMs", startedEpochMs)
                put("appVersion", Brand.VERSION)
                put("status", "active")
                put("timelineChainAlgorithm", "SHA-256")
                put("timelineChainGenesis", SessionChain.GENESIS)
            }
        )
    }

    @Synchronized
    fun append(
        state: DetectionState,
        sensor: SensorSnapshot,
        external: ExternalPresenceReading?,
        wifiRf: WifiRfReading? = null,
        wifiSurvey: WifiSurveyReading? = null,
        humanRf: HumanRfReading? = null
    ) {
        if (stopped) return
        val nowElapsed = SystemClock.elapsedRealtime()
        if (nowElapsed - lastWriteElapsedMs < SAMPLE_MS) return
        if (sessionDir == null) start()
        lastWriteElapsedMs = nowElapsed
        frameCount++
        if (state.anomaly) anomalyCount++

        val row = JSONObject().apply {
            put("chainVersion", 2)
            put("epochMs", System.currentTimeMillis())
            put("elapsedMs", nowElapsed)
            put("humanLike", state.humanLike)
            put("candidateAnomaly", state.candidateAnomaly)
            put("anomaly", state.anomaly)
            put("track", state.trackLabel ?: JSONObject.NULL)
            put("bodyScore", state.bodyScore)
            put("fusedScore", state.fusedScore)
            put("sceneQuality", state.sceneQuality.score)
            put("sceneQualityLabel", state.sceneQuality.label)
            put("consensusRatio", state.consensusRatio)
            put("consensusAgeMs", state.consensusAgeMs)
            put("reason", state.anomalyReason ?: JSONObject.NULL)
            put("magneticMicroTesla", sensor.magneticMicroTesla ?: JSONObject.NULL)
            put("lightLux", sensor.lightLux ?: JSONObject.NULL)
            put("pressureHpa", sensor.pressureHpa ?: JSONObject.NULL)
            put("audioDbfs", sensor.audioDbfs ?: JSONObject.NULL)
            put("sensorNovelty", sensor.novelty)
            put("externalDetected", external?.detected ?: JSONObject.NULL)
            put("externalConfidence", external?.confidence ?: JSONObject.NULL)
            put("externalDistanceMetres", external?.distanceMetres ?: JSONObject.NULL)
            put("externalSource", external?.source ?: JSONObject.NULL)
            put("rfStatus", wifiRf?.status?.name ?: JSONObject.NULL)
            put("rfSource", wifiRf?.source ?: JSONObject.NULL)
            put("rfNovelty", wifiRf?.novelty ?: JSONObject.NULL)
            put("rfSustainedChange", wifiRf?.sustainedChange ?: JSONObject.NULL)
            put("rfSampleRateHz", wifiRf?.sampleRateHz ?: JSONObject.NULL)
            put("rfRssiDbm", wifiRf?.rssiDbm ?: JSONObject.NULL)
            put("rfCsiAmplitude", wifiRf?.csiAmplitude ?: JSONObject.NULL)
            put("rfCsiVariance", wifiRf?.csiVariance ?: JSONObject.NULL)
            put("rfSynthetic", wifiRf?.let { if (it.status != WifiRfStatus.OFF) it.synthetic else null } ?: JSONObject.NULL)
            put("rfAuth", wifiRf?.auth?.name ?: JSONObject.NULL)
            put("rfMeasuredRateHz", wifiRf?.measuredRateHz ?: JSONObject.NULL)
            put("rfPacketLossPct", wifiRf?.packetLossPercent ?: JSONObject.NULL)
            put("humanRfState", humanRf?.state?.name ?: JSONObject.NULL)
            put("humanRfPatternConfidence", humanRf?.patternConfidence ?: JSONObject.NULL)
            put("humanRfAlgorithm", humanRf?.algorithm ?: JSONObject.NULL)
            put("wifiVisibleNetworks", wifiSurvey?.visibleNetworks ?: JSONObject.NULL)
            put("wifiStrongestRssiDbm", wifiSurvey?.strongestRssiDbm ?: JSONObject.NULL)
            put("wifiMedianRssiDbm", wifiSurvey?.medianRssiDbm ?: JSONObject.NULL)
            put("explanation", state.explanation.toJson())
        }
        val rowHash = SessionChain.computeHash(previousChainHash, row)
        row.put("chainPrev", previousChainHash)
        row.put("chainHash", rowHash)
        timelineFile?.appendText(row.toString() + "\n")
        previousChainHash = rowHash
    }

    @Synchronized
    fun markEvent(bundleName: String, state: DetectionState) {
        val dir = sessionDir ?: return
        File(dir, "markers.jsonl").appendText(
            JSONObject().apply {
                put("epochMs", System.currentTimeMillis())
                put("bundleName", bundleName)
                put("confidence", state.fusedScore)
                put("reason", state.anomalyReason ?: "manual")
                put("track", state.trackLabel ?: JSONObject.NULL)
            }.toString() + "\n"
        )
    }

    @Synchronized
    fun stop() {
        val dir = sessionDir ?: return
        stopped = true
        try {
        val ended = System.currentTimeMillis()
        writeJsonAtomically(
            File(dir, "session.json"),
            JSONObject().apply {
                put("schemaVersion", AppSchema.EVIDENCE_SCHEMA_VERSION)
                put("sessionId", dir.name)
                put("startedEpochMs", startedEpochMs)
                put("endedEpochMs", ended)
                put("durationMs", (ended - startedEpochMs).coerceAtLeast(0L))
                put("sampleCount", frameCount)
                put("anomalySamples", anomalyCount)
                put("appVersion", Brand.VERSION)
                put("status", "closed")
                put("timelineChainTail", previousChainHash)
            }
        )
        EvidenceIntegrity.refreshManifest(dir, Brand.VERSION)
        EvidenceSigner.signIntegrityManifest(dir)
        sessionDir = null
        timelineFile = null
        startedEpochMs = 0L
        frameCount = 0
        anomalyCount = 0
        lastWriteElapsedMs = 0L
        previousChainHash = SessionChain.GENESIS
        } finally {
            ActiveSessions.closed(dir.name)
        }
    }

    fun recentSessions(): List<String> = root.listFiles().orEmpty()
        .filter { it.isDirectory && it.name.startsWith("Session_") }
        .sortedByDescending { it.name }.take(30).map { it.name }

    private fun sessionById(id: String?): File? = recentSessions()
        .firstOrNull { id == null || it == id }?.let { File(root, it) }

    fun latestSummary(sessionId: String? = null): String {
        val dir = sessionById(sessionId) ?: return "No recorded session yet."
        val meta = File(dir, "session.json")
        var samples = 0
        var anomalies = 0
        var candidate = 0
        var fusionSum = 0.0
        var fusionCount = 0
        File(dir, "timeline.jsonl").takeIf { it.exists() }?.useLines { lines -> lines.forEach { line ->
            samples++
            runCatching { JSONObject(line) }.getOrNull()?.let { row ->
                if (row.optBoolean("anomaly")) anomalies++
                if (row.optBoolean("candidateAnomaly")) candidate++
                row.optDouble("fusedScore").takeIf { it.isFinite() }?.let { fusionSum += it; fusionCount++ }
            }
        } }
        val avgFusion = if (fusionCount > 0) fusionSum / fusionCount else null

        val status = runCatching { JSONObject(meta.readText()).optString("status", "unknown") }.getOrDefault("unknown")
        val metadata = runCatching { JSONObject(meta.readText()) }.getOrNull()
        val closed = status == "closed"
        val chain = SessionChain.verify(File(dir, "timeline.jsonl"),
            metadata?.optString("timelineChainTail")?.takeIf { closed && it.isNotBlank() },
            metadata?.optInt("sampleCount")?.takeIf { closed })
        return buildString {
            append(dir.name).append('\n')
            append("Status: ").append(status).append('\n')
            append("Samples: ").append(samples).append('\n')
            append("Candidate anomaly samples: ").append(candidate).append('\n')
            append("Sustained anomaly samples: ").append(anomalies).append('\n')
            if (avgFusion != null) append("Average fused confidence: ").append("%.0f%%".format(avgFusion * 100)).append('\n')
            append("Timeline: ").append(File(dir, "timeline.jsonl").name).append('\n')
            append("Chain: ").append(if (chain.valid) "VERIFIED" else "FAILED").append(" • ").append(chain.message)
            if (closed && File(dir, "integrity.json").exists()) {
                val signature = EvidenceVerifier.verifyBundle(dir, requireLocalSigner = true)
                append("\nClosed session signature: ").append(if (signature.valid) "VERIFIED" else "FAILED")
            }
        }
    }

    fun latestReplay(limit: Int = 24, sessionId: String? = null): List<String> {
        val dir = sessionById(sessionId) ?: return emptyList()
        val timeline = File(dir, "timeline.jsonl")
        if (!timeline.exists()) return emptyList()
        val tail = java.util.ArrayDeque<String>()
        timeline.useLines { lines -> lines.forEach { line ->
            tail.addLast(line)
            while (tail.size > limit.coerceAtLeast(1)) tail.removeFirst()
        } }
        return tail.mapNotNull { line ->
            runCatching {
                val j = JSONObject(line)
                val time = SimpleDateFormat("HH:mm:ss", Locale.UK).format(Date(j.optLong("epochMs")))
                val state = when {
                    j.optBoolean("anomaly") -> "ANOMALY"
                    j.optBoolean("candidateAnomaly") -> "candidate"
                    j.optBoolean("humanLike") -> "human-like"
                    else -> "clear"
                }
                val fused = (j.optDouble("fusedScore", 0.0) * 100.0).toInt()
                val quality = j.optString("sceneQualityLabel", "--")
                "$time  ${state.padEnd(10)}  FUSED ${fused.toString().padStart(3)}%  Q $quality"
            }.getOrNull()
        }
    }

    private fun writeJsonAtomically(file: File, value: JSONObject) {
        file.parentFile?.mkdirs()
        val temp = File(file.parentFile, file.name + ".tmp")
        temp.writeText(value.toString(2))
        if (!temp.renameTo(file)) {
            file.writeText(temp.readText())
            temp.delete()
        }
    }

    companion object {
        private const val SAMPLE_MS = 500L
    }
}
