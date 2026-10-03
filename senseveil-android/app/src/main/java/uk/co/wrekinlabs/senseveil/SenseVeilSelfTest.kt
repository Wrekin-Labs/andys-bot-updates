package uk.co.wrekinlabs.senseveil

import android.content.Context
import java.io.File
import java.security.MessageDigest

data class SelfTestCheck(val label: String, val passed: Boolean, val detail: String)

data class SelfTestReport(val checks: List<SelfTestCheck>) {
    val passed: Boolean get() = checks.all { it.passed }
    fun asText(): String = buildString {
        append(if (passed) "SELF-TEST PASS" else "SELF-TEST ATTENTION").append("\n\n")
        checks.forEach { check ->
            append(if (check.passed) "✓ " else "! ")
                .append(check.label).append(" — ").append(check.detail).append('\n')
        }
        append("\nThis tests app plumbing and local cryptography. It does not certify camera/radar measurement accuracy.")
    }
}

object SenseVeilSelfTest {
    fun run(context: Context, repository: EventRepository): SelfTestReport {
        val checks = mutableListOf<SelfTestCheck>()

        checks += runCheck("Evidence storage") {
            val root = repository.eventRoot
            root.mkdirs()
            require(root.exists() && root.canWrite()) { "event storage not writable" }
            "writable • ${root.freeSpace / (1024L * 1024L)} MB filesystem free"
        }

        checks += runCheck("Signing key") {
            val id = EvidenceSigner.localSignerFingerprint()
            require(id.length == 64) { "unexpected signer fingerprint" }
            "P-256 key ready • ${id.take(12)}…"
        }

        checks += runCheck("Secure vault round-trip") {
            val dir = File(context.cacheDir, "SenseVeilSelfTest").apply { mkdirs() }
            val source = File(dir, "plain.bin")
            val encrypted = File(dir, "roundtrip.sve")
            val restored = File(dir, "restored.bin")
            val probe = "SenseVeil-self-test-v1".toByteArray()
            source.writeBytes(probe)
            try {
                SecureEvidenceVault.encryptFile(source, encrypted)
                SecureEvidenceVault.decryptFile(encrypted, restored)
                require(MessageDigest.isEqual(probe, restored.readBytes())) { "round-trip bytes differ" }
                "AES-GCM encrypt/decrypt verified"
            } finally {
                dir.deleteRecursively()
            }
        }

        checks += runCheck("Device health") {
            val health = DeviceHealthMonitor.inspect(context, repository.eventRoot)
            if (health.health == "OK") "battery/thermal/storage OK" else health.warnings.joinToString("; ")
        }

        checks += runCheck("Camera feature") {
            val hasCamera = context.packageManager.hasSystemFeature("android.hardware.camera.any")
            require(hasCamera) { "no camera feature reported" }
            "camera feature present"
        }

        return SelfTestReport(checks)
    }

    private inline fun runCheck(label: String, block: () -> String): SelfTestCheck =
        try {
            SelfTestCheck(label, true, block())
        } catch (error: Throwable) {
            SelfTestCheck(label, false, error.message ?: error::class.java.simpleName)
        }
}
