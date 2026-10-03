package uk.co.wrekinlabs.senseveil

import java.io.File
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class EvidenceRetentionTest {
    @get:Rule val temp = TemporaryFolder()
    private fun bundle(root: File, name: String, age: Long, bytes: Int = 20) = File(root, name).apply {
        mkdirs(); File(this, "payload").writeBytes(ByteArray(bytes)); setLastModified(age)
    }

    @Test fun expiredPendingCaptureAndItsArchiveSurvive() {
        val root = temp.newFolder()
        val pending = bundle(root, "Event_pending", 1_000)
        val expired = bundle(root, "Event_expired", 1_000)
        val vault = File(root, "vault/Event_pending.sve").apply { parentFile.mkdirs(); writeText("vault"); setLastModified(1_000) }
        val result = EvidenceRetention.prune(root, 2_000, Long.MAX_VALUE) { it == pending.name }
        assertTrue(pending.exists()); assertTrue(vault.exists()); assertFalse(expired.exists())
        assertEquals(1, result.deletedItems)
    }

    @Test fun quotaSkipsActiveOldestAndDeletesWholeCompletedBundle() {
        val root = temp.newFolder()
        val pending = bundle(root, "Event_pending", 1_000, 30)
        val completed = bundle(root, "Event_completed", 2_000, 40)
        val log = File(root, "events.jsonl").apply { writeText("retained log") }
        val result = EvidenceRetention.prune(root, 0, 1) { it == pending.name }
        assertTrue(pending.exists()); assertFalse(completed.exists()); assertTrue(log.exists())
        assertEquals(40L, result.freedBytes)
        assertTrue("Quota can remain exceeded while capture is active", result.remainingBytes > 1)
    }

    @Test fun completedCaptureBecomesEligibleWithoutSplittingPayloads() {
        val root = temp.newFolder()
        val capture = bundle(root, "Event_capture", 1_000)
        var pending = true
        EvidenceRetention.prune(root, 2_000, 0) { pending }
        assertTrue(capture.exists())
        pending = false
        val result = EvidenceRetention.prune(root, 2_000, 0) { pending }
        assertFalse(capture.exists()); assertEquals(1, result.deletedItems)
    }

    @Test fun quotaKeepsNewestAndDoesNotDeleteRollingOrUnknownDirectories() {
        val root = temp.newFolder()
        val old = bundle(root, "Event_old", 1_000)
        val latest = bundle(root, "Event_latest", 2_000)
        val rolling = bundle(root, "rolling", 500, 5)
        val other = bundle(root, "notes", 500, 5)
        val result = EvidenceRetention.prune(root, 0, 30) { false }
        assertFalse(old.exists()); assertTrue(latest.exists()); assertTrue(rolling.exists()); assertTrue(other.exists())
        assertEquals(30L, result.remainingBytes)
    }
}
