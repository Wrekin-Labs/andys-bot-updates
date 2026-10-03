package uk.co.wrekinlabs.senseveil

import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest

data class SessionChainVerification(
    val valid: Boolean,
    val rows: Int,
    val failureAtRow: Int?,
    val message: String
)

object SessionChain {
    const val GENESIS = "0000000000000000000000000000000000000000000000000000000000000000"

    fun computeHash(previousHash: String, rowWithoutChain: JSONObject, legacyNumbers: Boolean = false): String {
        val input = previousHash.lowercase() + "|" + canonicalize(rowWithoutChain, legacyNumbers)
        return MessageDigest.getInstance("SHA-256")
            .digest(input.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
    }

    fun verify(timeline: File, expectedTail: String? = null, expectedRows: Int? = null): SessionChainVerification {
        if (!timeline.exists()) return SessionChainVerification(false, 0, 0, "Timeline missing")
        var previous = GENESIS
        var rows = 0
        timeline.useLines { lines ->
            for (line in lines) {
                if (line.isBlank()) continue
                rows++
                val row = runCatching { JSONObject(line) }.getOrElse {
                    return SessionChainVerification(false, rows - 1, rows, "Invalid JSON at row $rows")
                }
                val claimedPrev = row.optString("chainPrev")
                val claimedHash = row.optString("chainHash")
                if (!claimedPrev.equals(previous, ignoreCase = true)) {
                    return SessionChainVerification(false, rows - 1, rows, "Broken previous-hash link at row $rows")
                }
                val payload = JSONObject(row.toString()).apply {
                    remove("chainPrev")
                    remove("chainHash")
                }
                val expected = computeHash(previous, payload)
                val legacyMatches = !payload.has("chainVersion") &&
                    claimedHash.equals(computeHash(previous, payload, legacyNumbers = true), true)
                if (!claimedHash.equals(expected, ignoreCase = true) && !legacyMatches) {
                    return SessionChainVerification(false, rows - 1, rows, "Row hash mismatch at row $rows")
                }
                previous = claimedHash.lowercase()
            }
        }
        if (expectedRows != null && rows != expectedRows) {
            return SessionChainVerification(false, rows, rows + 1, "Timeline sample count differs from closing checkpoint")
        }
        if (expectedTail != null && !previous.equals(expectedTail, true)) {
            return SessionChainVerification(false, rows, rows + 1, "Timeline tail differs from closing checkpoint")
        }
        return SessionChainVerification(true, rows, null, "Hash chain verified across $rows sample(s)" +
            if (expectedTail == null) " • no closing checkpoint" else " • closing checkpoint matched")
    }

    private fun canonicalize(value: Any?, legacyNumbers: Boolean): String = when (value) {
        null, JSONObject.NULL -> "null"
        is JSONObject -> value.keys().asSequence().toList().sorted().joinToString(prefix = "{", postfix = "}") { key ->
            JSONObject.quote(key) + ":" + canonicalize(value.opt(key), legacyNumbers)
        }
        is JSONArray -> (0 until value.length()).joinToString(prefix = "[", postfix = "]") { i -> canonicalize(value.opt(i), legacyNumbers) }
        is String -> JSONObject.quote(value)
        is Number -> if (legacyNumbers) value.toString() else java.math.BigDecimal(value.toString()).stripTrailingZeros().toPlainString()
        is Boolean -> value.toString()
        else -> JSONObject.quote(value.toString())
    }
}
