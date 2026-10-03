package uk.co.wrekinlabs.senseveil

/** A bundle is sealed once, after every producer has stopped changing it. */
class CaptureCompletion(private val seal: (String) -> Unit) {
    private var imageReady = false
    private var windowReady = false
    private var videoStatus: String? = null
    private var finished = false

    @Synchronized fun imageReady() { imageReady = true; finishIfReady() }
    @Synchronized fun windowReady() { windowReady = true; finishIfReady() }
    @Synchronized fun videoReady(status: String) { if (videoStatus == null) videoStatus = status; finishIfReady() }
    @Synchronized fun fail() { finished = true }

    private fun finishIfReady() {
        if (!finished && imageReady && windowReady && videoStatus != null) {
            finished = true
            seal(videoStatus!!)
        }
    }
}
