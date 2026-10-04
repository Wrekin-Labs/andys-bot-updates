package uk.co.wrekinlabs.senseveil

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.location.LocationManager
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import androidx.core.content.ContextCompat
import androidx.core.location.LocationManagerCompat

/**
 * Android adapter around [RfBridgeClient]. Public API is unchanged from RC4
 * (start / stop / setDeviceMoving / resetBaseline) so MainActivity wiring stays the same.
 * Holds only the application context, so a worker that outlives an Activity cannot leak it.
 */
class WifiRfBridge(
    context: Context,
    private val preferences: OperatorPreferences,
    onReading: (WifiRfReading) -> Unit
) {
    private val appContext = context.applicationContext
    private val client = RfBridgeClient(
        config = {
            val key = preferences.rfBridgeKey
            RfBridgeConfig(
                host = preferences.rfBridgeHost,
                port = preferences.rfBridgePort,
                pairCode = preferences.rfPairCode,
                allowNonLocalHost = preferences.rfAllowNonLocalHost,
                v2Key = key,
                requireV2 = key != null // once a key exists, never silently downgrade to plaintext v1
            )
        },
        hasPermission = { hasLocalNetworkPermission(appContext) },
        onReading = onReading
    )

    fun start() = client.start()
    fun stop() = client.stop()
    fun setDeviceMoving(value: Boolean) = client.setDeviceMoving(value)
    fun resetBaseline() = client.resetBaseline()

    companion object {
        const val LOCAL_NETWORK_PERMISSION = "android.permission.ACCESS_LOCAL_NETWORK"

        /** Android 17 enforces local-network access; denial shows up as a connect TIMEOUT, not an exception. */
        fun hasLocalNetworkPermission(context: Context) =
            Build.VERSION.SDK_INT < 37 ||
                ContextCompat.checkSelfPermission(context, LOCAL_NETWORK_PERMISSION) == PackageManager.PERMISSION_GRANTED
    }
}

/**
 * Opt-in aggregate Wi-Fi survey. Only (frequency, level) pairs are read from scan results;
 * SSID and BSSID never leave this class. Unknown is reported as unknown (visibleNetworks = null),
 * never as "0 networks", because Android returns an empty list when Location Services are off.
 * All callbacks run on the main looper.
 */
class PhoneWifiSurvey(
    context: Context,
    private val intervalMs: () -> Long = { DEFAULT_INTERVAL_MS },
    private val onReading: (WifiSurveyReading) -> Unit
) {
    private val appContext = context.applicationContext
    private val wifi = appContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
    private val location = appContext.getSystemService(Context.LOCATION_SERVICE) as? LocationManager
    private val handler = Handler(Looper.getMainLooper())
    private var registered = false
    private var running = false

    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (!running) return
            val updated = intent?.getBooleanExtra(WifiManager.EXTRA_RESULTS_UPDATED, false) == true
            publishResults(if (updated) null else "scan not refreshed (throttled or failed); cached results")
        }
    }

    private val scanTask = object : Runnable {
        override fun run() {
            if (!running) return
            requestScan()
            handler.postDelayed(this, intervalMs().coerceAtLeast(MIN_SCAN_GAP_MS))
        }
    }

    fun start() {
        if (running) return
        if (wifi == null) {
            onReading(WifiSurveyReading(status = "Wi-Fi hardware unavailable"))
            return
        }
        running = true
        try {
            if (Build.VERSION.SDK_INT >= 33) {
                appContext.registerReceiver(receiver, IntentFilter(WifiManager.SCAN_RESULTS_AVAILABLE_ACTION), Context.RECEIVER_NOT_EXPORTED)
            } else {
                @Suppress("DEPRECATION")
                appContext.registerReceiver(receiver, IntentFilter(WifiManager.SCAN_RESULTS_AVAILABLE_ACTION))
            }
            registered = true
            // Resume/rotation must not burn the 4-scans-per-2-minutes foreground budget.
            val sinceLast = SystemClock.elapsedRealtime() - lastScanRequestElapsed
            if (lastScanRequestElapsed == 0L || sinceLast >= MIN_SCAN_GAP_MS) requestScan() else publishResults("using recent scan")
            handler.postDelayed(scanTask, intervalMs().coerceAtLeast(MIN_SCAN_GAP_MS))
        } catch (_: SecurityException) {
            running = false
            onReading(WifiSurveyReading(status = "Wi-Fi scan permission required"))
        }
    }

    fun stop() {
        running = false
        handler.removeCallbacks(scanTask)
        if (registered) runCatching { appContext.unregisterReceiver(receiver) }
        registered = false
    }

    private fun blockedReason(): String? {
        val manager = wifi ?: return "Wi-Fi hardware unavailable"
        if (ContextCompat.checkSelfPermission(appContext, android.Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            return "Wi-Fi scan permission required"
        }
        if (location != null && !LocationManagerCompat.isLocationEnabled(location)) return "Location Services off; Android hides scan results"
        @Suppress("DEPRECATION")
        if (!manager.isWifiEnabled && !manager.isScanAlwaysAvailable) return "Wi-Fi is off"
        return null
    }

    private fun requestScan() {
        blockedReason()?.let { onReading(WifiSurveyReading(status = it)); return }
        try {
            lastScanRequestElapsed = SystemClock.elapsedRealtime()
            @Suppress("DEPRECATION")
            val started = wifi!!.startScan()
            if (!started) publishResults("scan throttled; cached results")
        } catch (_: SecurityException) {
            onReading(WifiSurveyReading(status = "Wi-Fi scan permission required"))
        }
    }

    private fun publishResults(statusOverride: String? = null) {
        blockedReason()?.let { onReading(WifiSurveyReading(status = it)); return }
        try {
            val nowMicros = SystemClock.elapsedRealtime() * 1_000L
            // ScanResult.timestamp is microseconds since boot. Drop entries Android kept from old scans.
            val fresh = wifi!!.scanResults
                .map { (nowMicros - it.timestamp) / 1_000L to (it.frequency to it.level) }
                .filter { it.first in 0..MAX_RESULT_AGE_MS }
            val newestAge = fresh.minOfOrNull { it.first }
            val aggregate = WifiSurveyAggregator.aggregate(fresh.map { it.second }, newestResultAgeMs = newestAge)
            onReading(if (statusOverride == null) aggregate else aggregate.copy(status = statusOverride))
        } catch (_: SecurityException) {
            onReading(WifiSurveyReading(status = "Wi-Fi scan permission required"))
        }
    }

    companion object {
        const val DEFAULT_INTERVAL_MS = 30_000L
        /** Android 9+ allows a foreground app 4 scans per 2 minutes. */
        const val MIN_SCAN_GAP_MS = 30_000L
        const val MAX_RESULT_AGE_MS = 120_000L
        /** Process-wide, so a rotated Activity does not immediately rescan. Main thread only. */
        private var lastScanRequestElapsed = 0L
    }
}
