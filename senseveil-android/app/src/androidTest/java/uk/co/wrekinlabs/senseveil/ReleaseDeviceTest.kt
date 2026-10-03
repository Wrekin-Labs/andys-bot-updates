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
            val scroll=androidx.test.uiautomator.UiScrollable(UiSelector().scrollable(true))
            assertTrue("quick start reachable", scroll.scrollTextIntoView("QUICK START"))
            device.findObject(UiSelector().text("QUICK START")).click()
            device.pressBack()
            assertTrue(device.findObject(UiSelector().textStartsWith("SENSEVEIL TOOLS")).exists())
            device.pressBack()
            assertTrue(device.findObject(UiSelector().text("TOOLS")).exists())
            val screenshots=File(context.getExternalFilesDir(null),"qa").apply { mkdirs() }
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
}
