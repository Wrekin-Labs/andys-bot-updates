package uk.co.wrekinlabs.senseveil

import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

object EvidenceReport {
    fun write(bundle: File, event: ScanEvent) {
        val time = SimpleDateFormat("dd MMM yyyy HH:mm:ss.SSS", Locale.UK).format(Date(event.timestampEpochMs))
        val report = buildString {
            append("SENSEVEIL AI EVIDENCE REPORT\n")
            append("Version: ").append(Brand.VERSION).append('\n')
            append("Recorded: ").append(time).append('\n')
            append("Event type: ").append(event.type).append('\n')
            append("Confidence: ").append(event.confidence).append("%\n")
            append("Track: ").append(event.trackLabel ?: "--").append('\n')
            append("Profile: ").append(event.profile ?: "--").append('\n')
            append("Estimated distance: ").append(event.estimatedDistanceMetres?.let { "%.2f m".format(it) } ?: "--").append('\n')
            append("Scene quality: ").append(event.sceneQualityPercent?.let { "$it%" } ?: "--").append('\n')
            append("Consensus: ").append(event.consensusRatio?.let { "%.0f%%".format(it * 100f) } ?: "--").append('\n')
            append("Consensus age: ").append(event.consensusAgeMs?.let { "$it ms" } ?: "--").append('\n')
            append("Session: ").append(event.sessionId ?: "--").append('\n')
            append("\nWHY IT FIRED\n")
            append(event.anomalyReason ?: "manual capture").append('\n')
            if (!event.explanationSummary.isNullOrBlank()) append(event.explanationSummary).append('\n')
            append("\nENVIRONMENT\n")
            append("Magnetic field: ").append(event.magneticMicroTesla?.let { "%.2f uT".format(it) } ?: "--").append('\n')
            append("Light: ").append(event.lightLux?.let { "%.2f lux".format(it) } ?: "--").append('\n')
            append("Pressure: ").append(event.pressureHpa?.let { "%.2f hPa".format(it) } ?: "--").append('\n')
            append("Audio: ").append(event.audioDbfs?.let { "%.2f dBFS".format(it) } ?: "--").append('\n')
            append("\nWI-FI / RF (OPT-IN)\n")
            if (event.rfSynthetic == true) {
                append("*** RF SOURCE IS SYNTHETIC TEST DATA (MOCK BRIDGE). NOT REAL CSI. NOT EVIDENCE OF PRESENCE. ***\n")
            }
            append("RF status: ").append(event.rfStatus ?: "--").append('\n')
            append("RF source: ").append(event.rfSource ?: "--").append('\n')
            append("RF link authentication: ").append(when (event.rfAuth) {
                null -> "--"
                "HMAC_V2" -> "HMAC-SHA256 (protocol v2)"
                else -> "none (pair code only; not authenticated)"
            }).append('\n')
            append("RF algorithm: ").append(event.rfAlgorithm ?: "--").append('\n')
            append("RF novelty: ").append(event.rfNovelty?.let { "%.0f%%".format(it * 100f) } ?: "--").append('\n')
            append("Sustained RF change: ").append(event.rfSustainedChange?.toString() ?: "--").append('\n')
            append("RF sample rate: ").append(event.rfSampleRateHz?.let { "%.1f Hz".format(it) } ?: "--").append('\n')
            append("RF RSSI: ").append(event.rfRssiDbm?.let { "%.1f dBm".format(it) } ?: "--").append('\n')
            append("CSI amplitude: ").append(event.rfCsiAmplitude?.let { "%.4f".format(it) } ?: "--").append('\n')
            append("CSI variance: ").append(event.rfCsiVariance?.let { "%.4f".format(it) } ?: "--").append('\n')
            append("Visible Wi-Fi networks: ").append(event.wifiVisibleNetworks?.toString() ?: "--").append('\n')
            append("Strongest aggregate RSSI: ").append(event.wifiStrongestRssiDbm?.let { "$it dBm" } ?: "--").append('\n')
            append("Median aggregate RSSI: ").append(event.wifiMedianRssiDbm?.let { "$it dBm" } ?: "--").append('\n')
            append("\nINTERPRETATION NOTICE\n")
            append("An anomaly is a detector/sensor disagreement or sustained unusual signal. RF change records environmental radio variation only and must not be interpreted as identifying a person or seeing through a wall. It is not evidence of paranormal activity. Integrity hashes and signatures verify file consistency relative to the recorded signing key; they do not provide an external trusted timestamp or prove the identity of the operator.\n")
        }
        File(bundle, "report.txt").writeText(report)
    }
}
