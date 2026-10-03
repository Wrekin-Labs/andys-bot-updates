package uk.co.wrekinlabs.senseveil

import android.util.Base64
import org.json.JSONObject
import java.io.File
import java.security.KeyFactory
import java.security.MessageDigest
import java.security.Signature
import java.security.spec.X509EncodedKeySpec

data class EvidenceVerificationResult(
    val valid: Boolean,
    val checkedFiles: Int,
    val hashFailures: List<String>,
    val signatureValid: Boolean,
    val signerTrustedOnThisDevice: Boolean,
    val signerFingerprint: String?,
    val message: String
)

object EvidenceVerifier {
    fun verifyBundle(bundle: File, requireLocalSigner: Boolean = false): EvidenceVerificationResult {
        val manifestFile = File(bundle, "integrity.json")
        if (!manifestFile.exists()) {
            return EvidenceVerificationResult(false, 0, listOf("integrity.json missing"), false, false, null, "No integrity manifest")
        }

        val integrity = runCatching {
            require(manifestFile.length() <= 1024 * 1024) { "Manifest too large" }
            EvidenceManifest.check(bundle, JSONObject(manifestFile.readText()))
        }.getOrElse {
            return EvidenceVerificationResult(false, 0, listOf("Invalid manifest: ${it.message}"), false, false, null, "Invalid integrity manifest")
        }
        val failures = integrity.failures
        val checked = integrity.checked

        val signature = verifySignature(bundle)
        val trusted = signature.fingerprint?.let { fp ->
            runCatching { fp.equals(EvidenceSigner.localSignerFingerprint(), ignoreCase = true) }.getOrDefault(false)
        } ?: false
        val valid = failures.isEmpty() && signature.valid && (!requireLocalSigner || trusted)
        val message = when {
            failures.isNotEmpty() -> "${failures.size} evidence file(s) failed hashing"
            !signature.valid -> "File hashes match, but the ECDSA signature is invalid or missing"
            requireLocalSigner && !trusted -> "Signature is cryptographically valid, but it is not from this device's trusted SenseVeil key"
            trusted -> "Evidence verified: $checked files + trusted local-device signature"
            else -> "Evidence is cryptographically self-consistent. Signer fingerprint must be trusted separately."
        }
        return EvidenceVerificationResult(valid, checked, failures, signature.valid, trusted, signature.fingerprint, message)
    }

    private data class SignatureResult(val valid: Boolean, val fingerprint: String?)

    private fun verifySignature(bundle: File): SignatureResult = runCatching {
        val signatureFile = File(bundle, "integrity.sig.json")
        val manifestFile = File(bundle, "integrity.json")
        if (!signatureFile.exists() || !manifestFile.exists()) return SignatureResult(false, null)
        val envelope = JSONObject(signatureFile.readText())
        val signatureBytes = Base64.decode(envelope.getString("signatureBase64"), Base64.DEFAULT)
        val publicKeyBytes = Base64.decode(envelope.getString("publicKeyDerBase64"), Base64.DEFAULT)
        val publicKey = KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(publicKeyBytes))
        val fingerprint = MessageDigest.getInstance("SHA-256").digest(publicKeyBytes)
            .joinToString("") { "%02x".format(it) }
        val claimed = envelope.optString("signerFingerprintSha256")
        if (claimed.isNotBlank() && !claimed.equals(fingerprint, ignoreCase = true)) return SignatureResult(false, fingerprint)
        val verifier = Signature.getInstance("SHA256withECDSA")
        verifier.initVerify(publicKey)
        verifier.update(manifestFile.readBytes())
        SignatureResult(verifier.verify(signatureBytes), fingerprint)
    }.getOrElse { SignatureResult(false, null) }
}
