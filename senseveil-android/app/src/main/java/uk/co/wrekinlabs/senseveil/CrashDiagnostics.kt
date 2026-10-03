package uk.co.wrekinlabs.senseveil

import android.content.Context
import android.os.Build
import org.json.JSONObject
import java.io.File

object CrashDiagnostics {
    private const val MAX_STACK_CHARS = 12_000

    fun install(context: Context) {
        val app = context.applicationContext
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        if (previous is SenseVeilCrashHandler) return
        Thread.setDefaultUncaughtExceptionHandler(SenseVeilCrashHandler(app, previous))
    }

    fun lastCrashFile(context: Context): File =
        File(context.filesDir, "SenseVeilDiagnostics/last_crash.json")

    fun lastCrashSummary(context: Context): String {
        val file = lastCrashFile(context)
        if (!file.exists()) return "No crash report recorded by this installation."
        return runCatching {
            val j = JSONObject(file.readText())
            buildString {
                append("Last crash: ").append(j.optLong("epochMs")).append('\n')
                append("App: ").append(j.optString("appVersion")).append('\n')
                append("Android API: ").append(j.optInt("api")).append('\n')
                append("Thread: ").append(j.optString("thread")).append('\n')
                append("Error: ").append(j.optString("type")).append(": ").append(j.optString("message"))
            }
        }.getOrElse { "Crash report exists but could not be parsed: ${it.message ?: "unknown"}" }
    }

    private class SenseVeilCrashHandler(
        private val context: Context,
        private val previous: Thread.UncaughtExceptionHandler?
    ) : Thread.UncaughtExceptionHandler {
        override fun uncaughtException(thread: Thread, throwable: Throwable) {
            runCatching {
                val file = lastCrashFile(context)
                file.parentFile?.mkdirs()
                val stack = throwable.stackTraceToString().take(MAX_STACK_CHARS)
                val json = JSONObject().apply {
                    put("schemaVersion", AppSchema.SETTINGS_SCHEMA_VERSION)
                    put("epochMs", System.currentTimeMillis())
                    put("appVersion", Brand.VERSION)
                    put("androidRelease", Build.VERSION.RELEASE)
                    put("api", Build.VERSION.SDK_INT)
                    put("device", "${Build.MANUFACTURER} ${Build.MODEL}")
                    put("thread", thread.name)
                    put("type", throwable.javaClass.name)
                    put("message", throwable.message ?: "")
                    put("stack", stack)
                    put("privacy", "No camera frames, evidence media, microphone samples or location are collected by crash diagnostics.")
                }
                val temp = File(file.parentFile, file.name + ".tmp")
                temp.writeText(json.toString(2))
                if (!temp.renameTo(file)) { file.writeText(temp.readText()); temp.delete() }
            }
            previous?.uncaughtException(thread, throwable)
        }
    }
}
