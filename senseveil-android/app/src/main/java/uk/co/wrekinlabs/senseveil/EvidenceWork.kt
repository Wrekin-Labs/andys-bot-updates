package uk.co.wrekinlabs.senseveil

import java.util.concurrent.Executors

/** Process-owned: rotation must not discard an in-flight evidence callback. */
object EvidenceWork {
    val executor = Executors.newSingleThreadScheduledExecutor()
}
