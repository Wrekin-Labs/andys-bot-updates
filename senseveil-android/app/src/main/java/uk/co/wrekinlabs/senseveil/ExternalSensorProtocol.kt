package uk.co.wrekinlabs.senseveil

/**
 * Versioned line protocol for future BLE/USB adapters.
 *
 * Handshake:
 * SV1|HELLO|ID=radar-01|CAP=RADAR,RANGING|FW=1.2.0|SRC=garage-radar
 *
 * Reading:
 * SV1|RADAR|P=1|C=0.88|D=3.20|X=-0.15|V=0.12|SEQ=42|TS=1760000000000|SRC=mmwave
 */
sealed interface ExternalSensorMessage {
    data class Hello(
        val id: String,
        val capabilities: Set<ExternalSensorType>,
        val firmware: String?,
        val source: String
    ) : ExternalSensorMessage

    data class Reading(val value: ExternalPresenceReading) : ExternalSensorMessage
}

object ExternalSensorProtocol {
    fun parseMessage(line: String): ExternalSensorMessage? {
        if (line.length > 4096 || '\u0000' in line) return null
        val parts = line.trim().split('|')
        if (parts.size < 3 || parts[0] != "SV1") return null
        val pairs = parts.drop(2).map { token ->
            val split = token.split('=', limit = 2)
            if (split.size != 2 || split[0].isBlank()) return null
            split[0].uppercase(java.util.Locale.ROOT) to split[1]
        }
        if (pairs.map { it.first }.distinct().size != pairs.size) return null
        val values = pairs.toMap()
        for (key in listOf("C", "D", "X", "T", "V")) {
            if (key in values && values[key]?.toFloatOrNull()?.isFinite() != true) return null
        }
        for (key in listOf("SEQ", "TS")) {
            if (key in values && (values[key]?.toLongOrNull()?.let { it >= 0 } != true)) return null
        }
        if (values["D"]?.toFloatOrNull()?.let { it < 0 } == true) return null

        if (parts[1].equals("HELLO", ignoreCase = true)) {
            val id = values["ID"].orEmpty().trim()
            if (id.isBlank()) return null
            val capabilities = values["CAP"].orEmpty().split(',')
                .mapNotNull { runCatching { ExternalSensorType.valueOf(it.trim().uppercase()) }.getOrNull() }
                .toSet()
            return ExternalSensorMessage.Hello(
                id = id,
                capabilities = capabilities,
                firmware = values["FW"]?.takeIf { it.isNotBlank() },
                source = values["SRC"].orEmpty().ifBlank { id }
            )
        }

        val type = runCatching { ExternalSensorType.valueOf(parts[1].uppercase()) }.getOrNull() ?: return null
        val present = when (values["P"]?.lowercase()) {
            "1", "true", "yes" -> true
            "0", "false", "no" -> false
            else -> return null
        }
        val confidence = values["C"]?.toFloatOrNull()?.coerceIn(0f, 1f) ?: return null
        return ExternalSensorMessage.Reading(
            ExternalPresenceReading(
                detected = present,
                confidence = confidence,
                distanceMetres = values["D"]?.toFloatOrNull(),
                lateralOffset = values["X"]?.toFloatOrNull()?.coerceIn(-1f, 1f),
                source = values["SRC"].orEmpty().ifBlank { type.name.lowercase() },
                temperatureCelsius = values["T"]?.toFloatOrNull(),
                radialVelocityMetresPerSecond = values["V"]?.toFloatOrNull(),
                sensorType = type,
                sensorSequence = values["SEQ"]?.toLongOrNull(),
                sensorEpochMs = values["TS"]?.toLongOrNull()
            )
        )
    }

    fun parse(line: String): ExternalPresenceReading? =
        (parseMessage(line) as? ExternalSensorMessage.Reading)?.value
}
