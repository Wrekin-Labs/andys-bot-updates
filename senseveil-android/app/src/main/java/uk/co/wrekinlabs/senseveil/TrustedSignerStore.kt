package uk.co.wrekinlabs.senseveil

import android.content.Context

class TrustedSignerStore(context: Context) {
    private val prefs = context.getSharedPreferences("senseveil_trusted_signers", Context.MODE_PRIVATE)

    fun fingerprints(): Set<String> = prefs.getStringSet(KEY, emptySet()).orEmpty().map(::normalize).toSet()

    fun trust(fingerprint: String): Boolean {
        val normalized = normalize(fingerprint)
        if (!VALID.matches(normalized)) return false
        val next = fingerprints().toMutableSet().apply { add(normalized) }
        prefs.edit().putStringSet(KEY, next).apply()
        return true
    }

    fun untrust(fingerprint: String) {
        val normalized = normalize(fingerprint)
        val next = fingerprints().toMutableSet().apply { remove(normalized) }
        prefs.edit().putStringSet(KEY, next).apply()
    }

    fun isTrusted(fingerprint: String?): Boolean =
        fingerprint?.let { fingerprints().contains(normalize(it)) } == true

    fun clear() { prefs.edit().remove(KEY).apply() }

    fun render(): String = buildString {
        val list = fingerprints().sorted()
        if (list.isEmpty()) {
            append("No external signer fingerprints are pinned.\n")
        } else {
            append("PINNED EXTERNAL SIGNERS ").append(list.size).append('\n')
            list.forEachIndexed { i, fp -> append(i + 1).append(". ").append(fp).append('\n') }
        }
        append("\nPinning means this operator has chosen to recognise that exact public-key fingerprint. It does not prove the person's identity or provide an external timestamp.")
    }

    companion object {
        private const val KEY = "fingerprints"
        private val VALID = Regex("^[0-9a-f]{64}$")
        fun normalize(value: String): String = value.lowercase().filter { it in '0'..'9' || it in 'a'..'f' }
    }
}
