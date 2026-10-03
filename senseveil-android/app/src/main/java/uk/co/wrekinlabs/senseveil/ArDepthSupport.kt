package uk.co.wrekinlabs.senseveil

import android.content.Context
import com.google.ar.core.ArCoreApk
import com.google.ar.core.Config
import com.google.ar.core.Session

data class ArDepthReport(
    val arCoreAvailability: String,
    val installedAndSupported: Boolean,
    val depthSupported: Boolean?,
    val note: String
) {
    fun asText(): String = buildString {
        append("ARCORE ").append(arCoreAvailability).append('\n')
        append("DEPTH ").append(depthSupported?.let { if (it) "SUPPORTED" else "NOT SUPPORTED" } ?: "NOT PROBED").append('\n')
        append(note)
    }
}

object ArDepthSupport {
    fun inspect(context: Context, probeDepth: Boolean = false): ArDepthReport {
        val availability = ArCoreApk.getInstance().checkAvailability(context)
        val supported = availability == ArCoreApk.Availability.SUPPORTED_INSTALLED
        if (!supported || !probeDepth) {
            return ArDepthReport(
                arCoreAvailability = availability.name,
                installedAndSupported = supported,
                depthSupported = null,
                note = "AR depth is optional. Live CameraX scanning continues normally without ARCore."
            )
        }
        return runCatching {
            val session = Session(context)
            try {
                val depth = session.isDepthModeSupported(Config.DepthMode.AUTOMATIC)
                ArDepthReport(
                    arCoreAvailability = availability.name,
                    installedAndSupported = true,
                    depthSupported = depth,
                    note = if (depth) {
                        "Depth hardware/software path is available. A dedicated AR camera mode is required; SenseVeil does not claim CameraX and ARCore share the camera concurrently."
                    } else {
                        "ARCore is available, but this device does not report automatic depth support."
                    }
                )
            } finally { session.close() }
        }.getOrElse {
            ArDepthReport(availability.name, true, null, "Depth probe unavailable: ${it.javaClass.simpleName}")
        }
    }
}
