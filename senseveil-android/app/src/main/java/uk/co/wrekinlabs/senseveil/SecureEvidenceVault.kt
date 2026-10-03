package uk.co.wrekinlabs.senseveil

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.CipherInputStream
import javax.crypto.CipherOutputStream
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

object SecureEvidenceVault {
    private const val KEY_ALIAS = "senseveil_evidence_aes_v2"
    private const val MAGIC = "SVE2"

    fun encryptFile(source: File, destination: File): File {
        destination.parentFile?.mkdirs()
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
        val iv = cipher.iv

        destination.outputStream().buffered().use { raw ->
            val header = DataOutputStream(raw)
            header.writeUTF(MAGIC)
            header.writeInt(iv.size)
            header.write(iv)
            header.flush()
            CipherOutputStream(raw, cipher).use { encrypted ->
                source.inputStream().buffered().use { input -> input.copyTo(encrypted, 128 * 1024) }
            }
        }
        return destination
    }

    fun decryptFile(source: File, destination: File): File {
        destination.parentFile?.mkdirs()
        val temporary = File.createTempFile("verified-vault-", ".tmp", destination.parentFile)
        try {
        source.inputStream().buffered().use { raw ->
            val header = DataInputStream(raw)
            require(header.readUTF() == MAGIC) { "Not a SenseVeil SVE2 evidence file" }
            val ivLength = header.readInt()
            require(ivLength in 12..32) { "Invalid vault IV" }
            val iv = ByteArray(ivLength).also { header.readFully(it) }

            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), GCMParameterSpec(128, iv))
            temporary.outputStream().buffered().use { out ->
                val buffer = ByteArray(128 * 1024)
                while (true) {
                    val count = raw.read(buffer)
                    if (count < 0) break
                    cipher.update(buffer, 0, count)?.let { out.write(it) }
                }
                // Explicit doFinal propagates an invalid GCM tag. Never publish partial plaintext.
                out.write(cipher.doFinal())
            }
        }
        check(temporary.renameTo(destination)) { "Could not publish verified vault" }
        return destination
        } finally { temporary.delete() }
    }

    @Synchronized
    private fun getOrCreateKey(): SecretKey {
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (keyStore.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }

        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        )
        return generator.generateKey()
    }
}
