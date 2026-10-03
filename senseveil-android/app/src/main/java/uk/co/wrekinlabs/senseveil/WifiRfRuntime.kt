package uk.co.wrekinlabs.senseveil

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.PrintWriter
import java.net.InetSocketAddress
import java.net.Socket
import java.net.SocketTimeoutException
import java.util.concurrent.atomic.AtomicBoolean

class WifiRfBridge(
    context: Context,
    private val preferences: OperatorPreferences,
    private val onReading: (WifiRfReading) -> Unit
) {
    private val analyzer = WifiRfAnalyzer()
    private val running = AtomicBoolean(false)
    @Volatile private var deviceMoving = false
    @Volatile private var worker: Thread? = null

    fun start() {
        if (!running.compareAndSet(false, true)) return
        onReading(WifiRfReading(status = WifiRfStatus.CONNECTING, message = "connecting to paired RF bridge"))
        worker = Thread({ loop() }, "SenseVeil-RF").apply {
            isDaemon = true
            start()
        }
    }

    fun stop() {
        running.set(false)
        worker?.interrupt()
        worker = null
        onReading(WifiRfReading(status = WifiRfStatus.OFF, message = "RF bridge off"))
    }

    fun setDeviceMoving(value: Boolean) {
        deviceMoving = value
    }

    fun resetBaseline() {
        analyzer.reset()
        onReading(WifiRfReading(status = WifiRfStatus.CALIBRATING, message = "RF baseline reset"))
    }

    private fun loop() {
        while (running.get()) {
            try {
                Socket().use { socket ->
                    socket.connect(InetSocketAddress(preferences.rfBridgeHost, preferences.rfBridgePort), 2_500)
                    analyzer.reset()
                    onReading(WifiRfReading(status = WifiRfStatus.CALIBRATING, message = "RF bridge connected; recalibrating baseline"))
                    socket.soTimeout = 3_500
                    val output = PrintWriter(socket.getOutputStream(), true)
                    output.println(JSONObject().put("type", "senseveil_hello").put("v", 1).put("pair", preferences.rfPairCode).toString())
                    val input = BufferedReader(InputStreamReader(socket.getInputStream()))
                    while (running.get()) {
                        try {
                            val line = input.readLine() ?: break
                            val frame = WifiRfProtocol.parse(line, preferences.rfPairCode) ?: continue
                            onReading(analyzer.accept(frame, deviceMoving))
                        } catch (_: SocketTimeoutException) {
                            analyzer.stale(SystemClock.elapsedRealtime())?.let(onReading)
                        }
                    }
                }
            } catch (_: SecurityException) {
                onReading(WifiRfReading(status = WifiRfStatus.UNAVAILABLE, message = "local network permission required"))
            } catch (error: Exception) {
                if (running.get()) {
                    onReading(WifiRfReading(
                        status = WifiRfStatus.UNAVAILABLE,
                        message = "RF bridge unavailable: " + error.javaClass.simpleName
                    ))
                }
            }
            if (running.get()) {
                try {
                    Thread.sleep(1_500L)
                } catch (_: InterruptedException) {
                }
            }
        }
    }
}

class PhoneWifiSurvey(
    context: Context,
    private val onReading: (WifiSurveyReading) -> Unit
) {
    private val appContext = context.applicationContext
    private val wifi = appContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
    private val handler = Handler(Looper.getMainLooper())
    private var registered = false
    private var running = false

    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            publishResults()
        }
    }

    private val scanTask = object : Runnable {
        override fun run() {
            if (!running) return
            requestScan()
            handler.postDelayed(this, SCAN_INTERVAL_MS)
        }
    }

    fun start() {
        if (running) return
        running = true
        try {
            if (Build.VERSION.SDK_INT >= 33) {
                appContext.registerReceiver(
                    receiver,
                    IntentFilter(WifiManager.SCAN_RESULTS_AVAILABLE_ACTION),
                    Context.RECEIVER_NOT_EXPORTED
                )
            } else {
                @Suppress("DEPRECATION")
                appContext.registerReceiver(receiver, IntentFilter(WifiManager.SCAN_RESULTS_AVAILABLE_ACTION))
            }
            registered = true
            requestScan()
            handler.postDelayed(scanTask, SCAN_INTERVAL_MS)
        } catch (_: SecurityException) {
            onReading(WifiSurveyReading(status = "Wi-Fi scan permission required"))
        }
    }

    fun stop() {
        running = false
        handler.removeCallbacks(scanTask)
        if (registered) runCatching { appContext.unregisterReceiver(receiver) }
        registered = false
    }

    private fun requestScan() {
        if (!wifi.isWifiEnabled) {
            onReading(WifiSurveyReading(status = "Wi-Fi is off"))
            return
        }
        try {
            @Suppress("DEPRECATION")
            val started = wifi.startScan()
            if (!started) publishResults("scan throttled or unavailable")
        } catch (_: SecurityException) {
            onReading(WifiSurveyReading(status = "Wi-Fi scan permission required"))
        }
    }

    private fun publishResults(statusOverride: String? = null) {
        try {
            val aggregate = WifiSurveyAggregator.aggregate(wifi.scanResults.map { it.frequency to it.level })
            onReading(if (statusOverride == null) aggregate else aggregate.copy(status = statusOverride))
        } catch (_: SecurityException) {
            onReading(WifiSurveyReading(status = "Wi-Fi scan permission required"))
        }
    }

    companion object {
        private const val SCAN_INTERVAL_MS = 30_000L
    }
}
