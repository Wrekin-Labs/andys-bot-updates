package uk.co.wrekinlabs.senseveil

/** A rotation creates a second Activity before the old session finishes signing. */
object ActiveSessions {
    private val names = java.util.concurrent.ConcurrentHashMap.newKeySet<String>()
    fun opened(name: String) { names.add(name) }
    fun closed(name: String) { names.remove(name) }
    fun contains(name: String) = names.contains(name)
}
