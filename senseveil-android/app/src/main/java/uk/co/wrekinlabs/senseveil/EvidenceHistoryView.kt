package uk.co.wrekinlabs.senseveil

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.ViewGroup
import android.widget.*
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Readable history with actions bound to the selected event, not the latest capture. */
class EvidenceHistoryView(
    context: Context, private val repository: EventRepository,
    private val review: (ScanEvent) -> Unit, private val verify: (File) -> Unit,
    private val share: (File) -> Unit, close: () -> Unit
) : FrameLayout(context) {
    private val cards = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL }
    private val count = label("Loading captures…", 13f, Brand.TEXT_MUTED)
    private val statusUpdates = mutableListOf<() -> Unit>()
    private var alertsOnly = false
    private var generation = 0
    private val ticker = object : Runnable {
        override fun run() { if (isAttachedToWindow) { statusUpdates.forEach { it() }; postDelayed(this, 1500) } }
    }

    init {
        setBackgroundColor(0xEE080D12.toInt()); isClickable = true
        val panel = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL; setPadding(dp(16), dp(16), dp(16), dp(12))
            background = surface(0xFF10161D.toInt())
        }
        panel.addView(label("Events", 24f, Color.WHITE).apply { setTypeface(typeface, Typeface.BOLD) })
        panel.addView(count)
        val controls = LinearLayout(context)
        val filter = button("SHOW ALERTS") {}
        filter.setOnClickListener {
            alertsOnly = !alertsOnly; filter.text = if (alertsOnly) "SHOW ALL" else "SHOW ALERTS"; load()
        }
        controls.addView(filter, weighted())
        controls.addView(button("REFRESH") { load() }, weighted())
        panel.addView(controls)
        panel.addView(ScrollView(context).apply { addView(cards); isFillViewport = true },
            LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        panel.addView(button("CLOSE") { close() }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        addView(panel, LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT).apply {
            setMargins(dp(12), dp(28), dp(12), dp(24))
        })
        load()
    }

    private fun load() {
        val request = ++generation
        EvidenceWork.executor.execute {
            val result = runCatching { repository.recent(30) }
            post {
                if (request != generation) return@post
                cards.removeAllViews(); statusUpdates.clear()
                if (result.isFailure) { count.text = "Unable to read captures. Tap Refresh to retry."; return@post }
                val all = result.getOrThrow()
                val events = if (alertsOnly) all.filter { !it.anomalyReason.isNullOrBlank() } else all
                count.text = "${events.size} ${if (alertsOnly) "alerts" else "captures"} • most recent first"
                if (events.isEmpty()) cards.addView(label(if (alertsOnly) "No detector-disagreement captures in the latest 30 events."
                    else "Your captures will appear here. Close this screen and tap Capture to save your first event.", 16f, Brand.TEXT_MUTED))
                events.forEach { addCard(it) }
            }
        }
    }

    private fun addCard(event: ScanEvent) {
        val time = SimpleDateFormat("dd MMM • HH:mm:ss", Locale.UK).format(Date(event.timestampEpochMs))
        val title = if (event.type.equals("manual", true)) "Manual capture" else "Detection capture"
        val card = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL; setPadding(dp(12), dp(10), dp(12), dp(8))
            background = surface(0xFF19232D.toInt())
        }
        card.addView(label(title, 17f, Color.WHITE).apply { setTypeface(typeface, Typeface.BOLD) })
        card.addView(label(time, 13f, Brand.TEXT_MUTED))
        card.addView(label("Fusion score ${event.confidence}% • ${event.profile ?: "Default"}", 14f, Brand.CYAN))
        card.addView(label(event.anomalyReason ?: "No sustained detector disagreement recorded", 13f, Brand.TEXT_MUTED))
        val status = label("Checking saved files…", 13f, Brand.AMBER)
        status.setPadding(0, dp(6), 0, dp(4)); card.addView(status)
        val bundle = repository.bundleFor(event)
        val actions = LinearLayout(context)
        actions.addView(button("REVIEW") { review(event) }.apply { contentDescription = "Review $title at $time" }, weighted())
        val verifyButton = button("VERIFY") { bundle?.let(verify) }.apply { contentDescription = "Verify $title at $time" }
        val shareButton = button("SHARE") { bundle?.let(share) }.apply { contentDescription = "Share $title at $time" }
        actions.addView(verifyButton, weighted()); actions.addView(shareButton, weighted()); card.addView(actions)
        val update = {
            val sealed = bundle?.let { !CaptureProgress.isPending(it.name) && repository.isSealed(it) } == true
            status.text = when {
                bundle == null || !bundle.exists() -> "Files unavailable • the log is retained"
                CaptureProgress.isPending(bundle.name) -> "Saving • waiting for evidence to seal"
                sealed -> "Sealed • tap Verify to check integrity"
                else -> "Unsealed • cannot share yet"
            }
            status.setTextColor(if (sealed) Brand.CYAN else Brand.AMBER)
            verifyButton.isEnabled = sealed; shareButton.isEnabled = sealed
            verifyButton.alpha = if (sealed) 1f else 0.45f; shareButton.alpha = verifyButton.alpha
        }
        update(); statusUpdates.add(update)
        cards.addView(card, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
            setMargins(0, dp(6), 0, dp(6))
        })
    }

    private fun label(value: String, size: Float, color: Int) = TextView(context).apply {
        text = value; textSize = size; setTextColor(color); setPadding(0, dp(2), 0, dp(2))
    }
    private fun button(value: String, action: () -> Unit) = Button(context).apply {
        text = value; textSize = 12f; isAllCaps = false; minHeight = dp(48)
        setPadding(dp(3), dp(4), dp(3), dp(4)); setTextColor(Brand.CYAN)
        background = surface(0xFF101820.toInt()); setOnClickListener { action() }
    }
    private fun weighted() = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { setMargins(dp(2), dp(4), dp(2), dp(4)) }
    private fun surface(color: Int) = GradientDrawable().apply { setColor(color); cornerRadius = dp(12).toFloat(); setStroke(dp(1), 0x4456DDEB) }
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
    override fun onAttachedToWindow() { super.onAttachedToWindow(); post(ticker) }
    override fun onDetachedFromWindow() { removeCallbacks(ticker); generation++; super.onDetachedFromWindow() }
}
