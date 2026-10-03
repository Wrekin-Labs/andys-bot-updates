package uk.co.wrekinlabs.senseveil

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import android.os.Build
import android.os.PowerManager
import android.os.StatFs
import java.io.File

data class DeviceHealthSnapshot(
    val batteryPercent: Int?,
    val charging: Boolean?,
    val thermalStatus: String,
    val freeStorageMb: Long,
    val health: String,
    val warnings: List<String>
) {
    fun asText(): String = buildString {
        append("HEALTH ").append(health).append('\n')
        append("BATTERY ").append(batteryPercent?.let { "$it%" } ?: "--")
        charging?.let { append(if (it) " charging" else " discharging") }
        append('\n')
        append("THERMAL ").append(thermalStatus).append('\n')
        append("FREE STORAGE ").append(freeStorageMb).append(" MB")
        if (warnings.isNotEmpty()) {
            append("\n\nWARNINGS\n")
            warnings.forEach { append("• ").append(it).append('\n') }
        }
    }
}

object DeviceHealthMonitor {
    fun inspect(context: Context, storageRoot: File): DeviceHealthSnapshot {
        val battery = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val level = battery?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)?.takeIf { it >= 0 }
        val scale = battery?.getIntExtra(BatteryManager.EXTRA_SCALE, -1)?.takeIf { it > 0 }
        val percent = if (level != null && scale != null) (level * 100 / scale) else null
        val status = battery?.getIntExtra(BatteryManager.EXTRA_STATUS, -1)
        val charging = status?.let { it == BatteryManager.BATTERY_STATUS_CHARGING || it == BatteryManager.BATTERY_STATUS_FULL }

        val thermal = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
            thermalLabel(pm.currentThermalStatus)
        } else "unsupported"

        val stat = StatFs(storageRoot.absolutePath)
        val freeMb = stat.availableBytes / (1024L * 1024L)
        val warnings = buildList {
            if (percent != null && percent <= 15 && charging != true) add("Low battery may interrupt long scan sessions")
            if (freeMb < 512L) add("Low storage may prevent evidence/video capture")
            if (thermal in setOf("severe", "critical", "emergency", "shutdown")) add("Thermal throttling may reduce camera/AI performance")
        }
        val health = if (warnings.isEmpty()) "OK" else "ATTENTION"
        return DeviceHealthSnapshot(percent, charging, thermal, freeMb, health, warnings)
    }

    private fun thermalLabel(status: Int): String = when (status) {
        PowerManager.THERMAL_STATUS_NONE -> "none"
        PowerManager.THERMAL_STATUS_LIGHT -> "light"
        PowerManager.THERMAL_STATUS_MODERATE -> "moderate"
        PowerManager.THERMAL_STATUS_SEVERE -> "severe"
        PowerManager.THERMAL_STATUS_CRITICAL -> "critical"
        PowerManager.THERMAL_STATUS_EMERGENCY -> "emergency"
        PowerManager.THERMAL_STATUS_SHUTDOWN -> "shutdown"
        else -> "unknown($status)"
    }
}
