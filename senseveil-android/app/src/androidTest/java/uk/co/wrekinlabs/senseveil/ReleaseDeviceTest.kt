package uk.co.wrekinlabs.senseveil

import android.Manifest
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.rule.GrantPermissionRule
import androidx.test.core.app.ActivityScenario
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.UiSelector
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith
import java.io.File

@RunWith(AndroidJUnit4::class)
class ReleaseDeviceTest {
    @get:Rule val cameraPermission: GrantPermissionRule = GrantPermissionRule.grant(Manifest.permission.CAMERA)
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private fun auditDirectory(): File = File(InstrumentationRegistry.getArguments().getString("additionalTestOutputDir")
        ?: File(context.getExternalFilesDir(null), "qa").absolutePath).apply { mkdirs() }
    @get:Rule val failureEvidence = object : org.junit.rules.TestWatcher() {
        override fun failed(error: Throwable?, description: org.junit.runner.Description) {
            val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
            val qa = auditDirectory()
            device.takeScreenshot(File(qa, "failed-${description.methodName}.png"))
            device.dumpWindowHierarchy(File(qa, "failed-${description.methodName}.xml"))
        }
    }

    @Before fun wakeAndUnlockTestDevice() {
        val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        device.wakeUp()
        device.executeShellCommand("wm dismiss-keyguard")
    }

    @Test fun poseCoordinatesFollowCameraRotationCropAndScale() {
        val sensorToBuffer = android.graphics.Matrix().apply { setScale(.5f, .5f) }
        val sensorToView = android.graphics.Matrix().apply { setScale(2f, 2f); postTranslate(-20f, 30f) }
        val rotations = mapOf(0 to floatArrayOf(100f, 50f), 90 to floatArrayOf(50f, 100f),
            180 to floatArrayOf(100f, 50f), 270 to floatArrayOf(50f, 100f))
        rotations.forEach { (rotation, center) ->
            val transform = PoseProjection.uprightToView(200, 100, rotation, sensorToBuffer, sensorToView)!!
            transform.mapPoints(center)
            assertEquals("Center x at rotation $rotation", 380f, center[0], .001f)
            assertEquals("Center y at rotation $rotation", 230f, center[1], .001f)
        }
        val origin = floatArrayOf(0f, 0f)
        PoseProjection.uprightToView(200, 100, 90, sensorToBuffer, sensorToView)!!.mapPoints(origin)
        assertArrayEquals(floatArrayOf(-20f, 430f), origin, .001f)
        assertNull(PoseProjection.uprightToView(200, 100, 45, sensorToBuffer, sensorToView))
    }

    @Test fun keystoreSignatureAndVaultRejectTampering() {
        val root=File(context.cacheDir,"release-crypto-${System.nanoTime()}").apply { mkdirs() }
        try {
            val bundle=File(root,"bundle").apply { mkdirs() }
            val source=File(bundle,"sample.txt").apply { writeText("SenseVeil device regression") }
            EvidenceIntegrity.refreshManifest(bundle,Brand.VERSION)
            EvidenceSigner.signIntegrityManifest(bundle)
            assertTrue(EvidenceVerifier.verifyBundle(bundle,true).valid)
            val encrypted=SecureEvidenceVault.encryptFile(source,File(root,"sample.sve"))
            val restored=SecureEvidenceVault.decryptFile(encrypted,File(root,"restored.txt"))
            assertArrayEquals(source.readBytes(),restored.readBytes())
            val corrupt=encrypted.readBytes().also { it[it.lastIndex]=(it.last().toInt() xor 1).toByte() }
            encrypted.writeBytes(corrupt)
            val rejected=File(root,"must-not-exist.txt")
            assertTrue(runCatching { SecureEvidenceVault.decryptFile(encrypted,rejected) }.isFailure)
            assertFalse(rejected.exists())
            source.appendText("tampered")
            assertFalse(EvidenceVerifier.verifyBundle(bundle,true).valid)
        } finally { root.deleteRecursively() }
    }

    @Test fun toolsScrollBackAndDiagnosticsAreUsable() {
        val device=UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            device.waitForIdle()
            val tools=device.findObject(UiSelector().text("TOOLS"))
            assertTrue("TOOLS button", tools.waitForExists(10000))
            tools.click()
            val screenshots = auditDirectory()
            device.takeScreenshot(File(screenshots,"tools-top.png"))
            val scroll=androidx.test.uiautomator.UiScrollable(UiSelector().scrollable(true))
            assertTrue("quick start reachable", scroll.scrollTextIntoView("QUICK START"))
            device.takeScreenshot(File(screenshots,"tools-bottom.png"))
            device.findObject(UiSelector().text("QUICK START")).click()
            device.pressBack()
            // The Tools header is above the viewport after scrolling to Quick Start.
            assertTrue("Back returns to the scrolled Tools list", device.findObject(UiSelector().text("QUICK START").className("android.widget.Button")).exists())
            device.pressBack()
            assertTrue(device.findObject(UiSelector().text("TOOLS")).exists())
            device.takeScreenshot(File(screenshots,"scanner-portrait.png"))
            scenario.onActivity { it.requestedOrientation=android.content.pm.ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE }
            device.waitForIdle()
            assertTrue(device.findObject(UiSelector().text("TOOLS")).waitForExists(10000))
            device.takeScreenshot(File(screenshots,"scanner-landscape.png"))
            device.findObject(UiSelector().text("TOOLS")).click()
            assertTrue(DiagnosticsBundle.create(context,OperatorPreferences(context),SecurityPreferences(context)).length() > 0)
        }
    }

    @Test fun captureSealsAfterActivityRotation() {
        val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        val events = EventRepository(context).eventRoot
        val existing = events.listFiles().orEmpty().map { it.name }.toSet()
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            val capture = device.findObject(UiSelector().text("CAPTURE").enabled(true))
            assertTrue("Camera becomes ready", capture.waitForExists(45_000))
            capture.click()
            val imageDeadline = android.os.SystemClock.elapsedRealtime() + 20_000
            var bundle: File? = null
            while (android.os.SystemClock.elapsedRealtime() < imageDeadline && bundle == null) {
                bundle = events.listFiles().orEmpty().firstOrNull { dir ->
                    dir.isDirectory && dir.name !in existing && File(dir, "explanation.json").exists()
                }
                if (bundle == null) android.os.SystemClock.sleep(200)
            }
            assertNotNull("Camera capture writes event metadata", bundle)
            scenario.onActivity { activity ->
                activity.requestedOrientation = if (activity.resources.configuration.orientation == android.content.res.Configuration.ORIENTATION_LANDSCAPE)
                    android.content.pm.ActivityInfo.SCREEN_ORIENTATION_PORTRAIT else android.content.pm.ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
            }
            val sealDeadline = android.os.SystemClock.elapsedRealtime() + 40_000
            val signature = File(bundle!!, "integrity.sig.json")
            while (!signature.exists() && android.os.SystemClock.elapsedRealtime() < sealDeadline) android.os.SystemClock.sleep(200)
            assertTrue("Interrupted capture finishes signing", signature.exists())
            val result = EvidenceVerifier.verifyBundle(bundle!!, true)
            assertTrue("All captured media is signed: ${result.message}", result.valid)
            assertTrue(File(bundle, "telemetry_window.csv").exists())
            assertTrue(File(bundle, "detections_window.jsonl").exists())
        }
    }

    @Test fun historyVerifiesSelectedCaptureAndBlocksUnsealedExport() {
        val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        val repository = EventRepository(context)
        val sealed = repository.createEventBundle("qa_selected")
        val pending = repository.createEventBundle("qa_unsealed")
        val stamp = System.currentTimeMillis()
        fun event(bundle: File, time: Long) = ScanEvent(time, "manual", 85, "H01", null,
            44f, 92f, null, null, profile = "Balanced", bundleName = bundle.name,
            explanationSummary = "No sustained anomaly", sceneQualityPercent = 100)
        try {
            File(sealed, "sample.txt").writeText("selected evidence")
            EvidenceIntegrity.refreshManifest(sealed, Brand.VERSION)
            EvidenceSigner.signIntegrityManifest(sealed)
            repository.append(event(sealed, stamp))
            repository.append(event(pending, stamp + 1))
            assertNull("History cannot resolve paths outside its event directory", repository.bundleFor(event(sealed, stamp).copy(bundleName = "../outside")))
            assertNull(repository.bundleFor(event(sealed, stamp).copy(bundleName = "Event_../outside")))
            ActivityScenario.launch(MainActivity::class.java).use {
                device.findObject(UiSelector().text("EVENTS")).also { assertTrue(it.waitForExists(10000)); it.click() }
                assertTrue(device.findObject(UiSelector().text("Unsealed • cannot share yet")).waitForExists(10000))
                assertFalse("Newest incomplete capture cannot be shared", device.findObject(UiSelector().text("SHARE").instance(0)).isEnabled)
                assertTrue("Earlier sealed capture can be verified", device.findObject(UiSelector().text("VERIFY").instance(1)).isEnabled)
                device.takeScreenshot(File(auditDirectory(), "events-cards.png"))
                device.findObject(UiSelector().text("VERIFY").instance(1)).click()
                val verified = device.findObject(UiSelector().textContains("STATUS VERIFIED"))
                assertTrue("Selected earlier capture verifies while newest is incomplete", verified.waitForExists(15000))
                assertTrue(verified.text.contains(sealed.name))
                assertFalse(verified.text.contains(pending.name))
                device.takeScreenshot(File(auditDirectory(), "event-verified.png"))
                device.pressBack()
                device.findObject(UiSelector().text("REVIEW").instance(1)).click()
                assertTrue(device.findObject(UiSelector().text("EVENT REVIEW")).waitForExists(10000))
                device.takeScreenshot(File(auditDirectory(), "event-review.png"))
                device.pressBack()
                device.findObject(UiSelector().text("SHARE").instance(1)).click()
                val zip = repository.shareCacheFileFor(sealed)
                val deadline = android.os.SystemClock.elapsedRealtime() + 15000
                while (android.os.SystemClock.elapsedRealtime() < deadline &&
                    !runCatching { java.util.zip.ZipFile(zip).use { it.getEntry("sample.txt") != null } }.getOrDefault(false)) android.os.SystemClock.sleep(200)
                assertTrue("Sharing the selected event creates its ZIP", zip.exists())
                java.util.zip.ZipFile(zip).use { archive ->
                    assertNotNull(archive.getEntry("sample.txt"))
                    assertEquals("selected evidence", archive.getInputStream(archive.getEntry("sample.txt")).bufferedReader().readText())
                }
                device.pressBack()
            }
        } finally { sealed.deleteRecursively(); pending.deleteRecursively() }
    }
}
