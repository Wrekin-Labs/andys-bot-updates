package uk.co.wrekinlabs.senseveil

import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.nio.file.Files

class EvidenceSchemaCompatibilityTest {
    private val rc1 = """{"timestampEpochMs":1790000000000,"type":"manual","confidence":72,"trackLabel":"H01","estimatedDistanceMetres":2.5,"magneticMicroTesla":48.2,"lightLux":120.0,"pressureHpa":null,"audioDbfs":null,"note":"manual capture","bundleName":"Event_20260101_000000_000_manual_abcd1234"}"""
    private val rc4 = """{"schemaVersion":3,"timestampEpochMs":1790000000000,"type":"auto_anomaly","confidence":81,"trackLabel":null,"estimatedDistanceMetres":null,"magneticMicroTesla":50.1,"lightLux":3.2,"pressureHpa":1012.4,"audioDbfs":-61.5,"rfStatus":"RF_CHANGE","rfSource":"esp32-csi","rfNovelty":0.71,"rfSustainedChange":true,"rfSampleRateHz":20.0,"rfRssiDbm":-55.2,"rfCsiAmplitude":0.84,"rfCsiVariance":0.031,"wifiVisibleNetworks":0,"wifiStrongestRssiDbm":null,"wifiMedianRssiDbm":null,"note":"automatic detector-disagreement capture","sessionId":"Session_20260101_000000_abcd1234"}"""

    @Test fun rc1EventWithoutRfFieldsParsesWithNulls() {
        val e = EventRepository.parseLine(rc1)!!
        assertEquals("manual", e.type)
        assertNull(e.rfStatus); assertNull(e.rfSustainedChange); assertNull(e.rfSynthetic)
        assertNull(e.wifiVisibleNetworks); assertNull(e.sceneQualityPercent); assertNull(e.consensusAgeMs)
    }

    @Test fun rc4Schema3EventParsesAndLacksSchema4Fields() {
        val e = EventRepository.parseLine(rc4)!!
        assertEquals("RF_CHANGE", e.rfStatus)
        assertEquals(true, e.rfSustainedChange)
        assertEquals(0.84f, e.rfCsiAmplitude!!, 1e-6f)
        assertNull(e.rfSynthetic); assertNull(e.rfAuth); assertNull(e.rfAlgorithm)
        assertNull(e.humanRfState); assertNull(e.humanRfPatternConfidence); assertNull(e.humanRfAlgorithm)
    }

    @Test fun schema5RoundTripPreservesHumanRfResearchFields() {
        val e = EventRepository.parseLine(rc4)!!.copy(
            rfSynthetic = true,
            rfAuth = "PAIR_CODE_ONLY",
            rfAlgorithm = WifiRfAnalyzer.ALGORITHM,
            humanRfState = HumanRfState.HUMAN_COMPATIBLE_MOTION.name,
            humanRfPatternConfidence = 0.72f,
            humanRfAlgorithm = HumanRfInterpreter.ALGORITHM
        )
        val json = e.toJson()
        assertEquals(AppSchema.EVIDENCE_SCHEMA_VERSION, json.optInt("schemaVersion"))
        assertEquals(e, EventRepository.parseLine(json.toString()))
        val dir = Files.createTempDirectory("sv-report").toFile()
        try {
            EvidenceReport.write(dir, e)
            val report = File(dir, "report.txt").readText()
            assertTrue(report.contains("SYNTHETIC TEST DATA"))
            assertTrue(report.contains("not authenticated"))
            assertTrue(report.contains("Human RF research state: HUMAN_COMPATIBLE_MOTION"))
            assertTrue(report.contains("not proof of occupancy"))
        } finally { dir.deleteRecursively() }
    }

    @Test fun corruptHistoryLinesAreSkippedNotFatal() {
        assertNull(EventRepository.parseLine("{truncated"))
        assertNull(EventRepository.parseLine(""))
    }
}
