package uk.co.wrekinlabs.senseveil

import android.content.Context
import org.json.JSONObject
import java.io.File

data class SessionRecoveryResult(val recoveredSessions: Int, val names: List<String>)

object SessionRecovery {
    fun recoverInterrupted(context: Context): SessionRecoveryResult {
        val root = File(context.getExternalFilesDir(null) ?: context.filesDir, "SenseVeilSessions")
        if (!root.exists()) return SessionRecoveryResult(0, emptyList())
        val recovered = mutableListOf<String>()
        root.listFiles()?.filter { it.isDirectory && it.name.startsWith("Session_") }?.forEach { dir ->
            if (ActiveSessions.contains(dir.name)) return@forEach
            val meta = File(dir, "session.json")
            if (!meta.exists()) return@forEach
            runCatching {
                val json = JSONObject(meta.readText())
                if (json.optString("status") == "active") {
                    json.put("status", "recovered_after_interruption")
                    json.put("recoveredEpochMs", System.currentTimeMillis())
                    json.put("recoveryNote", "Previous process ended before session close. Existing timeline was preserved.")
                    meta.writeText(json.toString(2))
                    recovered += dir.name
                }
            }
        }
        return SessionRecoveryResult(recovered.size, recovered)
    }
}
