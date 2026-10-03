package uk.co.wrekinlabs.senseveil

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class ReleaseRegressionTest {
    @get:Rule val temp = TemporaryFolder()

    @Test fun rejectsNonFiniteAndMalformedSensorPackets() {
        for (frame in listOf("C=NaN", "C=Infinity", "C=0.8|D=-1", "C=0.8|T=NaN",
            "C=0.8|SEQ=no", "C=0.8|TS=-1", "C=0.8|C=0.9")) {
            assertNull(frame, ExternalSensorProtocol.parse("SV1|RADAR|P=1|$frame"))
        }
        assertNotNull(ExternalSensorProtocol.parse("SV1|THERMAL|P=1|C=0.9|T=37.2"))
    }

    @Test fun rejectsMetadataDowngradeAndStalePackets() {
        val guard = ExternalSensorReplayGuard()
        val r = ExternalPresenceReading(true, .8f, 2f, source="radar", sensorSequence=1, sensorEpochMs=100000)
        assertTrue(guard.check(r, 100000).accepted)
        assertFalse(guard.check(r.copy(sensorSequence=null), 100001).accepted)
        assertFalse(guard.check(r.copy(sensorEpochMs=null, sensorSequence=2), 100001).accepted)
        assertFalse(guard.check(r.copy(sensorSequence=2), 200000).accepted)
        assertFalse(guard.check(r.copy(sensorEpochMs=Long.MAX_VALUE, sensorSequence=2), 100001).accepted)
    }

    @Test fun consensusDoesNotCarryAcrossPauseOrUnknownIdentity() {
        val gate = TemporalConsensusGate()
        repeat(6) { gate.update("r1", true, 8, 6, 400, 1000L + it*100) }
        assertFalse(gate.update("r1", true, 8, 6, 400, 5000).sustained)
        repeat(10) { assertFalse(gate.update(null, true, 8, 6, 0, 6000L + it*100).sustained) }
    }

    private fun manifest(file: File): JSONObject = JSONObject().put("files", JSONArray().put(
        JSONObject().put("path", file.name).put("bytes", file.length()).put("sha256", EvidenceIntegrity.sha256(file))))

    @Test fun manifestRejectsTamperingExtraFilesAndTraversal() {
        val root = temp.newFolder()
        val payload = File(root, "event.json").apply { writeText("original") }
        val manifest = manifest(payload)
        assertTrue(EvidenceManifest.check(root, manifest).failures.isEmpty())
        payload.writeText("tampered")
        assertTrue(EvidenceManifest.check(root, manifest).failures.isNotEmpty())
        payload.writeText("original")
        File(root, "unsigned.txt").writeText("not authenticated")
        assertTrue(EvidenceManifest.check(root, manifest).failures.any { "not signed" in it })
        manifest.getJSONArray("files").getJSONObject(0).put("path", "../outside")
        assertTrue(EvidenceManifest.check(root, manifest).failures.any { "Unsafe" in it })
    }

    @Test fun emptyOrDuplicateManifestCannotVerify() {
        val root = temp.newFolder()
        assertTrue(EvidenceManifest.check(root, JSONObject().put("files", JSONArray())).failures.isNotEmpty())
        val payload = File(root,"sample.txt").apply { writeText("test") }
        val m = manifest(payload)
        m.getJSONArray("files").put(m.getJSONArray("files").getJSONObject(0))
        assertTrue(EvidenceManifest.check(root, m).failures.any { "duplicate" in it })
    }

    @Test fun chainDetectsModificationAndTailTruncation() {
        val file = temp.newFile()
        var previous = SessionChain.GENESIS
        repeat(3) { index ->
            val row = JSONObject().put("sample",index).put("value", index * 0.1)
            val hash = SessionChain.computeHash(previous,row)
            row.put("chainPrev",previous).put("chainHash",hash)
            file.appendText(row.toString()+"\n")
            previous=hash
        }
        assertTrue(SessionChain.verify(file,previous,3).valid)
        val original=file.readText()
        file.writeText(file.readLines().take(2).joinToString("\n")+"\n")
        assertFalse(SessionChain.verify(file,previous,3).valid)
        file.writeText(original.replace("\"sample\":1", "\"sample\":9"))
        assertFalse(SessionChain.verify(file,previous,3).valid)
    }
}
