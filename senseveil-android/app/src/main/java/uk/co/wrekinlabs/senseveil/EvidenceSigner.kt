package uk.co.wrekinlabs.senseveil

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.io.File
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.MessageDigest
import java.security.Signature
import java.security.spec.ECGenParameterSpec

object EvidenceSigner {
    private const val KEY_ALIAS = "senseveil_evidence_signing_ec_v1"

    fun signIntegrityManifest(bundle: File): File {
        val manifest = File(bundle, "integrity.json")
        require(manifest.exists()) { "integrity.json missing" }
        val keyStore = keyStore()
        ensureKeyPair(keyStore)
        val privateKey = keyStore.getKey(KEY_ALIAS, null) as java.security.PrivateKey
        val publicKey = keyStore.getCertificate(KEY_ALIAS).publicKey

        val signer = Signature.getInstance("SHA256withECDSA")
        signer.initSign(privateKey)
        signer.update(manifest.readBytes())
        val signature = signer.sign()
        val publicDer = publicKey.encoded

        val envelope = JSONObject().apply {
            put("format", "senseveil-signature-v1")
            put("algorithm", "SHA256withECDSA")
            put("signedFile", "integrity.json")
            put("signatureBase64", Base64.encodeToString(signature, Base64.NO_WRAP))
            put("publicKeyDerBase64", Base64.encodeToString(publicDer, Base64.NO_WRAP))
            put("signerFingerprintSha256", fingerprint(publicDer))
            put("note", "Device-held key signature; not an external trusted timestamp or identity certificate.")
        }
        return File(bundle, "integrity.sig.json").also { it.writeText(envelope.toString(2)) }
    }

    fun localSignerFingerprint(): String {
        val keyStore = keyStore()
        ensureKeyPair(keyStore)
        return fingerprint(keyStore.getCertificate(KEY_ALIAS).publicKey.encoded)
    }

    private fun keyStore(): KeyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    @Synchronized
    private fun ensureKeyPair(keyStore: KeyStore) {
        if (keyStore.containsAlias(KEY_ALIAS)) return
        val generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore")
        generator.initialize(
            KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY
            )
                .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
                .setDigests(KeyProperties.DIGEST_SHA256)
                .build()
        )
        generator.generateKeyPair()
    }

    private fun fingerprint(bytes: ByteArray): String =
        MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
}
