package uk.co.wrekinlabs.senseveil

import java.util.concurrent.Executors

/** Process-owned: rotation must not discard an in-flight evidence callback. */
object EvidenceWork {
    val executor = Executors.newSingleThreadScheduledExecutor()
    // ML Kit posts task completions after an Activity is destroyed. Keep the
    // executor alive and let the retired Activity discard those results.
    val analysisExecutor = Executors.newSingleThreadExecutor()
}
