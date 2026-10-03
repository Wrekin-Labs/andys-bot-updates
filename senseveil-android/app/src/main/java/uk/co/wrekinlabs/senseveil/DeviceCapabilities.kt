package uk.co.wrekinlabs.senseveil

import android.content.Context
import android.content.pm.PackageManager
import android.hardware.Sensor
import android.hardware.SensorManager
import android.os.Build
import androidx.core.content.ContextCompat

data class DeviceCapabilityReport(val lines: List<String>) {
    fun asText(): String = lines.joinToString("\n")
}

object DeviceCapabilities {
    fun inspect(context: Context): DeviceCapabilityReport {
        val pm = context.packageManager
        val sm = context.getSystemService(Context.SENSOR_SERVICE) as SensorManager
        val has = { feature: String -> pm.hasSystemFeature(feature) }
        val fineLocation = ContextCompat.checkSelfPermission(context, android.Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        val localNetwork = Build.VERSION.SDK_INT < 37 ||
            ContextCompat.checkSelfPermission(context, "android.permission.ACCESS_LOCAL_NETWORK") == PackageManager.PERMISSION_GRANTED

        val lines = buildList {
            add("ANDROID ${Build.VERSION.RELEASE} / API ${Build.VERSION.SDK_INT}")
            add("CAMERA ${yes(has(PackageManager.FEATURE_CAMERA_ANY))}   FLASH ${yes(has(PackageManager.FEATURE_CAMERA_FLASH))}")
            add("MIC ${yes(has(PackageManager.FEATURE_MICROPHONE))}   BLE ${yes(has(PackageManager.FEATURE_BLUETOOTH_LE))}")
            add("WIFI " + yes(has(PackageManager.FEATURE_WIFI)) + "   WIFI SURVEY PERMISSION " + yes(fineLocation))
            add("LOCAL NETWORK PERMISSION " + yes(localNetwork))
            add("UWB ${yes(has("android.hardware.uwb"))}   WIFI RTT ${yes(Build.VERSION.SDK_INT >= 28 && has(PackageManager.FEATURE_WIFI_RTT))}")
            add("ANDROID RANGING API ${yes(Build.VERSION.SDK_INT >= 36)}")
            add("MAG ${yes(sm.getDefaultSensor(Sensor.TYPE_MAGNETIC_FIELD) != null)}   LIGHT ${yes(sm.getDefaultSensor(Sensor.TYPE_LIGHT) != null)}")
            add("BARO ${yes(sm.getDefaultSensor(Sensor.TYPE_PRESSURE) != null)}   ACCEL ${yes(sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER) != null)}")
            add("ARCORE PACKAGE ${yes(packageInstalled(pm, "com.google.ar.core"))}")
            add("DEPTH: optional ARCore module; capability must be checked by an ARCore session")
        }
        return DeviceCapabilityReport(lines)
    }

    private fun packageInstalled(pm: PackageManager, packageName: String): Boolean =
        runCatching {
            if (Build.VERSION.SDK_INT >= 33) {
                pm.getPackageInfo(packageName, PackageManager.PackageInfoFlags.of(0))
            } else {
                @Suppress("DEPRECATION") pm.getPackageInfo(packageName, 0)
            }
        }.isSuccess

    private fun yes(value: Boolean) = if (value) "YES" else "NO"
}
