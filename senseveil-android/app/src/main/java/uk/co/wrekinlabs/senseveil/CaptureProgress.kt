package uk.co.wrekinlabs.senseveil

/** Process-owned progress survives rotation; it is not an integrity verdict. */
object CaptureProgress {
    private val pending = java.util.concurrent.ConcurrentHashMap.newKeySet<String>()
    @Volatile private var lastMessage = "Ready to capture"
    fun started(name: String) { pending.add(name) }
    fun sealed(name: String) { pending.remove(name); lastMessage = "Evidence sealed • open Events to verify" }
    fun failed(name: String) { pending.remove(name); lastMessage = "Capture incomplete • check Events" }
    fun isPending(name: String) = pending.contains(name)
    fun hasPending() = pending.isNotEmpty()
    fun summary(): String = if (pending.isEmpty()) lastMessage else
        "Saving ${pending.size} capture${if (pending.size == 1) "" else "s"} • sealing may take 30s"
}
