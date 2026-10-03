package uk.co.wrekinlabs.senseveil

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.OnBackPressedCallback
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.appcompat.app.AppCompatActivity
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.mlkit.vision.MlKitAnalyzer
import androidx.camera.view.CameraController
import androidx.camera.view.LifecycleCameraController
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import com.google.mlkit.vision.face.FaceDetection
import com.google.mlkit.vision.face.FaceDetector
import com.google.mlkit.vision.face.FaceDetectorOptions
import com.google.mlkit.vision.objects.ObjectDetection
import com.google.mlkit.vision.objects.ObjectDetector
import com.google.mlkit.vision.objects.defaults.ObjectDetectorOptions
import com.google.mlkit.vision.pose.PoseDetector
import com.google.mlkit.vision.pose.PoseDetection
import com.google.mlkit.vision.pose.defaults.PoseDetectorOptions
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import kotlin.math.abs
import kotlin.math.roundToInt

class MainActivity : AppCompatActivity() {

    private lateinit var cameraController: LifecycleCameraController
    private lateinit var previewView: PreviewView
    private lateinit var overlayView: DetectionOverlayView
    private lateinit var radarView: RadarView

    private lateinit var statusText: TextView
    private lateinit var detailText: TextView
    private lateinit var sensorText: TextView
    private lateinit var bufferText: TextView
    private lateinit var modeButton: Button
    private lateinit var lightButton: Button
    private lateinit var captureButton: Button

    private lateinit var poseDetector: PoseDetector
    private lateinit var faceDetector: FaceDetector
    private lateinit var objectDetector: ObjectDetector

    private val analysisExecutor: ExecutorService = Executors.newSingleThreadExecutor()
    private val ioExecutor = EvidenceWork.executor
    private val mainHandler = Handler(Looper.getMainLooper())

    private lateinit var eventRepository: EventRepository
    private lateinit var profileStore: ProfileStore
    private lateinit var currentProfile: DetectionProfile
    private lateinit var alertPolicyStore: AlertPolicyStore
    private lateinit var alertMode: AlertMode
    private lateinit var sessionRecorder: SessionRecorder
    private lateinit var securityPreferences: SecurityPreferences
    private lateinit var retentionManager: RetentionManager
    private lateinit var trustedSignerStore: TrustedSignerStore
    private lateinit var operatorPreferences: OperatorPreferences
    private val externalReplayGuard = ExternalSensorReplayGuard()
    private var lastImportedSignerFingerprint: String? = null
    private var lastImportedSignatureValid = false
    private val consensusGate = TemporalConsensusGate()
    private val sensorTimeline = SensorTimeline()
    private val detectionTimeline = DetectionTimeline()
    private lateinit var sensorFusion: SensorFusionEngine
    private lateinit var audioMonitor: AudioLevelMonitor
    private val trackState = PersonTrackState()

    private var rollingBuffer: RollingVideoBuffer? = null
    private var externalHub: ExternalSensorHub = NoExternalSensorHub()
    private var externalReading: ExternalPresenceReading? = null
    private var sensorSnapshot = SensorSnapshot()
    private var latestDetection = DetectionState()

    private var labMode = false
    private var torchEnabled = false
    private var audioMonitoringEnabled = false
    private var lastAutoCaptureAt = 0L
    private var anomalyEpisodeLatched = false
    @Volatile private var captureInterruptionGeneration = 0L

    private val permissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { grants ->
            val cameraGranted = grants[Manifest.permission.CAMERA] == true ||
                ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
            if (cameraGranted) {
                startCamera()
                startRuntimeSensors()
            } else {
                statusText.text = "CAMERA PERMISSION REQUIRED"
                detailText.text = "Tap CAPTURE to retry camera permission, or enable it in Android Settings."
            }
        }


    private val audioPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            audioMonitoringEnabled = granted
            if (granted) {
                audioMonitor.start()
                bufferText.text = "AUDIO MONITOR: ON"
            } else {
                bufferText.text = "AUDIO MONITOR: PERMISSION NOT GRANTED"
            }
        }

    private val evidenceImportLauncher =
        registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
            if (uri == null) return@registerForActivityResult
            bufferText.text = "VERIFYING IMPORTED EVIDENCE…"
            submitIo {
                val result = runCatching { EvidenceImporter.importAndVerify(this, uri) }
                runOnUiThread {
                    result.onSuccess { imported ->
                        val v = imported.verification
                        lastImportedSignerFingerprint = v.signerFingerprint
                        lastImportedSignatureValid = v.signatureValid && v.hashFailures.isEmpty()
                        val pinned = trustedSignerStore.isTrusted(v.signerFingerprint)
                        val body = buildString {
                            append("FILE ").append(imported.displayName).append('\n')
                            append("STATUS ").append(if (v.valid) "VERIFIED" else "FAILED").append('\n')
                            append("FILES CHECKED ").append(v.checkedFiles).append('\n')
                            append("SIGNATURE ").append(if (v.signatureValid) "CRYPTO VALID" else "INVALID/MISSING").append('\n')
                            append("TRUSTED AS THIS DEVICE ").append(if (v.signerTrustedOnThisDevice) "YES" else "NO").append('\n')
                            append("PINNED BY OPERATOR ").append(if (pinned) "YES" else "NO").append('\n')
                            v.signerFingerprint?.let { append("SIGNER FP ").append(it.take(24)).append("…\n") }
                            append(v.message)
                            if (v.hashFailures.isNotEmpty()) {
                                append("\n\nFAILURES\n")
                                v.hashFailures.take(20).forEach { append("• ").append(it).append('\n') }
                            }
                        }
                        bufferText.text = if (v.valid) "IMPORTED EVIDENCE VERIFIED" else "IMPORTED EVIDENCE FAILED VERIFY"
                        showTextPanel("EVIDENCE VERIFY", body)
                    }.onFailure { err ->
                        bufferText.text = "VERIFY FAILED: ${err.message ?: "unknown"}"
                    }
                }
            }
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        CrashDiagnostics.install(this)
        if (Build.VERSION.SDK_INT < 35) {
            @Suppress("DEPRECATION")
            window.statusBarColor = Color.BLACK
            @Suppress("DEPRECATION")
            window.navigationBarColor = Color.BLACK
        }
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        eventRepository = EventRepository(this)
        securityPreferences = SecurityPreferences(this)
        retentionManager = RetentionManager(this, securityPreferences)
        trustedSignerStore = TrustedSignerStore(this)
        operatorPreferences = OperatorPreferences(this)
        val recovered = SessionRecovery.recoverInterrupted(this)
        val retention = retentionManager.run(eventRepository.eventRoot)
        profileStore = ProfileStore(this)
        currentProfile = profileStore.current
        alertPolicyStore = AlertPolicyStore(this)
        alertMode = alertPolicyStore.mode
        sessionRecorder = SessionRecorder(this).also { it.start() }
        buildUi()
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                val content = findViewById<ViewGroup>(android.R.id.content)
                if (content.childCount > 1) content.removeViewAt(content.childCount - 1)
                else { isEnabled = false; onBackPressedDispatcher.onBackPressed() }
            }
        })
        if (FirstRunGuide.shouldShow(this)) {
            bufferText.text = "FIRST RUN • OPEN TOOLS → QUICK START"
        }
        if (recovered.recoveredSessions > 0) {
            bufferText.text = "RECOVERED ${recovered.recoveredSessions} INTERRUPTED SESSION(S)"
        } else if (retention.deletedItems > 0) {
            bufferText.text = "HOUSEKEEPING: ${retention.deletedItems} OLD ITEM(S) REMOVED"
        }
        createDetectors()
        createSensorEngines()

        requestNeededPermissions()
    }

    private fun requestNeededPermissions() {
        val needed = buildList {
            if (ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                add(Manifest.permission.CAMERA)
            }
        }
        if (needed.isEmpty()) {
            startCamera()
            startRuntimeSensors()
        } else {
            permissionLauncher.launch(needed.toTypedArray())
        }
    }

    private fun buildUi() {
        val root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }

        previewView = PreviewView(this).apply {
            scaleType = PreviewView.ScaleType.FILL_CENTER
            implementationMode = PreviewView.ImplementationMode.COMPATIBLE
        }
        root.addView(previewView, matchParent())

        overlayView = DetectionOverlayView(this)
        root.addView(overlayView, matchParent())

        val brandBar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(10), dp(8), dp(12), dp(8))
            background = roundedPanel(Brand.PANEL)
        }
        val mark = BrandMarkView(this)
        brandBar.addView(mark, LinearLayout.LayoutParams(dp(46), dp(46)))

        val brandCopy = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(7), 0, 0, 0)
        }
        brandCopy.addView(TextView(this).apply {
            text = Brand.APP_NAME
            setTextColor(Color.WHITE)
            textSize = 18f
            setTypeface(typeface, Typeface.BOLD)
        })
        brandCopy.addView(TextView(this).apply {
            text = Brand.TAGLINE
            setTextColor(Brand.TEXT_MUTED)
            textSize = 10f
        })
        brandBar.addView(brandCopy, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))

        modeButton = compactButton("FIELD") { toggleLabMode() }
        brandBar.addView(modeButton, LinearLayout.LayoutParams(dp(70), dp(48)).apply { setMargins(0, 0, dp(4), 0) })
        val toolsButton = compactButton("TOOLS") { showToolsPanel() }
        brandBar.addView(toolsButton, LinearLayout.LayoutParams(dp(70), dp(48)))

        root.addView(
            brandBar,
            FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                gravity = Gravity.TOP
                setMargins(dp(10), dp(10), dp(10), 0)
            }
        )

        val statusPanel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(12), dp(9), dp(12), dp(9))
            background = roundedPanel(Brand.PANEL_SOFT)
        }
        statusText = TextView(this).apply {
            setTextColor(Color.WHITE)
            textSize = 18f
            setTypeface(Typeface.MONOSPACE, Typeface.BOLD)
            text = "INITIALISING SENSOR FUSION…"
        }
        detailText = TextView(this).apply {
            setTextColor(Brand.CYAN)
            textSize = 12f
            setTypeface(Typeface.MONOSPACE, Typeface.NORMAL)
            text = "VISION  |  POSE  |  OBJECT  |  FIELD"
        }
        statusPanel.addView(statusText)
        statusPanel.addView(detailText)

        root.addView(
            statusPanel,
            FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                gravity = Gravity.TOP
                setMargins(dp(10), dp(78), dp(10), 0)
            }
        )

        radarView = RadarView(this).apply { background = roundedPanel(0xAA0B1015.toInt()) }
        root.addView(
            radarView,
            FrameLayout.LayoutParams(dp(158), dp(126)).apply {
                gravity = Gravity.END or Gravity.TOP
                setMargins(0, dp(145), dp(10), 0)
            }
        )

        val bottomPanel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(10), dp(8), dp(10), dp(10))
            background = roundedPanel(Brand.PANEL)
        }

        sensorText = TextView(this).apply {
            setTextColor(0xFFD8EDF3.toInt())
            textSize = 11f
            setTypeface(Typeface.MONOSPACE, Typeface.NORMAL)
            text = "MAG --  LIGHT --  AUDIO --  PRESS --"
        }
        bufferText = TextView(this).apply {
            setTextColor(Brand.TEXT_MUTED)
            textSize = 10f
            setTypeface(Typeface.MONOSPACE, Typeface.NORMAL)
            text = "EVENT BUFFER: STARTING"
        }

        val buttonRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
        }
        captureButton = compactButton("CAPTURE") {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) requestNeededPermissions()
            else captureEvent("manual", latestDetection, false)
        }
        val events = compactButton("EVENTS") { showHistory() }
        lightButton = compactButton("LIGHT") { toggleTorch() }
        val wall = compactButton("RADAR") { showRadarInfo() }

        listOf(captureButton, events, lightButton, wall).forEach {
            buttonRow.addView(it, LinearLayout.LayoutParams(0, dp(48), 1f).apply { setMargins(dp(2), 0, dp(2), 0) })
        }

        val disclaimer = TextView(this).apply {
            setTextColor(0xFF8799A3.toInt())
            textSize = 9f
            text = "AI classifications and field readings are measurements/estimates, not evidence of paranormal activity. Through-wall mode requires external radar hardware."
        }

        bottomPanel.addView(sensorText)
        bottomPanel.addView(bufferText)
        bottomPanel.addView(buttonRow)
        bottomPanel.addView(disclaimer)

        root.addView(
            bottomPanel,
            FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                gravity = Gravity.BOTTOM
                setMargins(dp(10), 0, dp(10), dp(10))
            }
        )

        setContentView(root)
        ViewCompat.setOnApplyWindowInsetsListener(findViewById(android.R.id.content)) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }
    }

    private fun createDetectors() {
        poseDetector = PoseDetection.getClient(
            PoseDetectorOptions.Builder().setDetectorMode(PoseDetectorOptions.STREAM_MODE).build()
        )
        faceDetector = FaceDetection.getClient(
            FaceDetectorOptions.Builder()
                .setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_FAST)
                .enableTracking()
                .build()
        )
        objectDetector = ObjectDetection.getClient(
            ObjectDetectorOptions.Builder()
                .setDetectorMode(ObjectDetectorOptions.STREAM_MODE)
                .enableMultipleObjects()
                .enableClassification()
                .build()
        )
    }

    private fun createSensorEngines() {
        sensorFusion = SensorFusionEngine(this) { snapshot ->
            sensorSnapshot = snapshot
            sensorTimeline.add(snapshot)
            runOnUiThread { updateSensorText(snapshot) }
        }
        audioMonitor = AudioLevelMonitor(this) { db -> sensorFusion.setAudioDbfs(db) }
        externalHub.start { reading ->
            val decision = externalReplayGuard.check(reading)
            if (decision.accepted) {
                externalReading = reading
                runOnUiThread { radarView.update(latestDetection, externalReading) }
            } else {
                runOnUiThread { bufferText.text = "SENSOR PACKET REJECTED • ${decision.reason.uppercase()}" }
            }
        }
    }

    private fun startRuntimeSensors() {
        sensorFusion.start()
        if (audioMonitoringEnabled) audioMonitor.start()
    }

    private fun startCamera() {
        if (::cameraController.isInitialized) return

        cameraController = LifecycleCameraController(this).apply {
            cameraSelector = CameraSelector.DEFAULT_BACK_CAMERA
        }

        var videoEnabled = true
        try {
            cameraController.setEnabledUseCases(
                CameraController.IMAGE_CAPTURE or CameraController.IMAGE_ANALYSIS or CameraController.VIDEO_CAPTURE
            )
        } catch (_: Throwable) {
            videoEnabled = false
            cameraController.setEnabledUseCases(CameraController.IMAGE_CAPTURE or CameraController.IMAGE_ANALYSIS)
        }

        cameraController.setImageAnalysisAnalyzer(
            analysisExecutor,
            MlKitAnalyzer(
                listOf(poseDetector, faceDetector, objectDetector),
                ImageAnalysis.COORDINATE_SYSTEM_VIEW_REFERENCED,
                analysisExecutor
            ) { result ->
                val pose = result.getValue(poseDetector)
                val faces = result.getValue(faceDetector).orEmpty()
                val objects = result.getValue(objectDetector).orEmpty()

                val objectLabels = objects.flatMap { it.labels }.map { it.text }.filter { it.isNotBlank() }.distinct().take(3)
                val landmarks = pose?.allPoseLandmarks.orEmpty()
                val strongLandmarks = landmarks.count { it.inFrameLikelihood >= 0.55f }
                val averageLikelihood = if (landmarks.isEmpty()) 0f else
                    landmarks.map { it.inFrameLikelihood.toDouble() }.average().toFloat()

                val bodyScore = (
                    (strongLandmarks / 33f) * 0.65f + averageLikelihood * 0.35f
                    ).coerceIn(0f, 1f)

                val profile = currentProfile
                val lowLight = sensorSnapshot.lightLux?.let { it < 1.5f } == true && !torchEnabled
                val deviceMoving = sensorSnapshot.accelerationMs2?.let { abs(it - 9.81f) > 1.8f } == true
                val lowLightPenalty = if (lowLight) 0.06f else 0f
                val humanLike = strongLandmarks >= profile.minLandmarks &&
                    bodyScore >= (profile.humanBodyThreshold + lowLightPenalty)
                val facePresent = faces.isNotEmpty()
                val track = trackState.update(humanLike)
                val distance = DistanceEstimator.estimateFromPose(pose, previewView.width)
                val horizontal = DistanceEstimator.horizontalOffset(pose, previewView.width)
                val ext = freshExternalReading()
                val fusion = FusionScorer.score(profile, bodyScore, facePresent, sensorSnapshot.novelty, ext)

                val modelDisagreement = humanLike && !facePresent && objects.isEmpty() && !deviceMoving &&
                    bodyScore >= (profile.disagreementThreshold + lowLightPenalty) && track.stability >= 0.35f
                val crossSensorDisagreement = ext?.detected == true && !humanLike && ext.confidence >= 0.70f
                val candidateReason = when {
                    modelDisagreement -> "vision models disagree on a stable human-like pose"
                    crossSensorDisagreement -> "external presence sensor disagrees with camera vision"
                    else -> null
                }
                val candidateAnomaly = candidateReason != null
                val consensusKey = when {
                    humanLike -> "vision:${track.label ?: "untracked"}"
                    ext?.detected == true -> "external:${ext.source}"
                    else -> null
                }
                val consensus = consensusGate.update(
                    key = consensusKey,
                    candidate = candidateAnomaly,
                    windowFrames = profile.consensusWindowFrames,
                    requiredPositiveFrames = profile.consensusRequiredFrames,
                    minimumDurationMs = profile.consensusMinimumDurationMs
                )
                val anomaly = consensus.sustained
                val quality = SceneQualityEvaluator.evaluate(lowLight, deviceMoving, strongLandmarks)
                val explanation = DetectionExplanationBuilder.build(
                    humanLike = humanLike,
                    facePresent = facePresent,
                    objectLabels = objectLabels,
                    strongLandmarks = strongLandmarks,
                    bodyScore = bodyScore,
                    lowLight = lowLight,
                    deviceMoving = deviceMoving,
                    trackStability = track.stability,
                    sensorNovelty = sensorSnapshot.novelty,
                    external = ext,
                    candidateReason = candidateReason,
                    consensus = consensus
                )

                val state = DetectionState(
                    humanLike = humanLike,
                    facePresent = facePresent,
                    objectCount = objects.size,
                    objectLabels = objectLabels,
                    bodyScore = bodyScore,
                    fusedScore = fusion.total,
                    candidateAnomaly = candidateAnomaly,
                    anomaly = anomaly,
                    anomalyReason = candidateReason,
                    consensusPositiveFrames = consensus.positiveFrames,
                    consensusWindowFrames = consensus.totalFrames,
                    consensusRatio = consensus.ratio,
                    consensusAgeMs = consensus.ageMs,
                    trackLabel = track.label,
                    trackStability = track.stability,
                    estimatedDistanceMetres = distance ?: ext?.distanceMetres,
                    horizontalOffset = if (humanLike) horizontal else ext?.lateralOffset ?: 0f,
                    strongLandmarks = strongLandmarks,
                    sensorNovelty = sensorSnapshot.novelty,
                    lowLight = lowLight,
                    deviceMoving = deviceMoving,
                    sceneQuality = quality,
                    explanation = explanation,
                    fusion = fusion
                )
                latestDetection = state
                detectionTimeline.add(state)
                runCatching { sessionRecorder.append(state, sensorSnapshot, ext) }.onFailure { error ->
                    runOnUiThread { if (!isDestroyed) bufferText.text = "SESSION WRITE FAILED: ${error.message}" }
                }

                runOnUiThread {
                    renderDetection(state)
                    overlayView.update(pose, faces, objects, state, labMode)
                    radarView.update(state, ext)
                }

                if (anomaly && !anomalyEpisodeLatched) {
                    anomalyEpisodeLatched = true
                    maybeAutoCapture(state)
                } else if (!candidateAnomaly) {
                    anomalyEpisodeLatched = false
                }
            }
        )

        previewView.controller = cameraController
        try {
            cameraController.bindToLifecycle(this)
        } catch (_: Exception) {
            videoEnabled = false
            cameraController.setEnabledUseCases(CameraController.IMAGE_CAPTURE or CameraController.IMAGE_ANALYSIS)
            try { cameraController.bindToLifecycle(this) } catch (error: Exception) {
                statusText.text = "CAMERA UNAVAILABLE"
                detailText.text = "Close other camera apps and reopen SenseVeil."
                bufferText.text = error.message ?: "Camera could not start"
                return
            }
        }

        statusText.text = "CAMERA STARTING…"
        captureButton.isEnabled = false
        cameraController.initializationFuture.addListener({
            if (isDestroyed) return@addListener
            try {
                try { cameraController.initializationFuture.get() } catch (_: Exception) {
                    videoEnabled = false
                    cameraController.setEnabledUseCases(CameraController.IMAGE_CAPTURE or CameraController.IMAGE_ANALYSIS)
                    cameraController.bindToLifecycle(this)
                }
                check(cameraController.cameraInfo != null) { "Camera provider is unavailable" }
                captureButton.isEnabled = true
                statusText.text = "SCANNING"
                detailText.text = "VISION ONLINE • SENSOR BASELINE LEARNING"
                if (videoEnabled) {
                    rollingBuffer = RollingVideoBuffer(this, cameraController, eventRepository) { status ->
                        runOnUiThread { if (!isDestroyed) bufferText.text = "EVENT BUFFER: $status" }
                    }.also {
                        it.setPerformanceMode(operatorPreferences.performanceMode)
                        if (lifecycle.currentState.isAtLeast(androidx.lifecycle.Lifecycle.State.RESUMED)) it.start()
                    }
                } else bufferText.text = "EVENT BUFFER: DEVICE COMBINATION UNSUPPORTED"
            } catch (error: Exception) {
                statusText.text = "CAMERA UNAVAILABLE"
                detailText.text = "Close other camera apps and reopen SenseVeil."
                bufferText.text = error.message ?: "Camera could not start"
            }
        }, ContextCompat.getMainExecutor(this))
    }

    private fun renderDetection(state: DetectionState) {
        val confidence = (state.fusedScore * 100f).roundToInt()
        val dist = state.estimatedDistanceMetres?.let { " • ~%.1fm EST".format(it) } ?: ""
        val extNow = freshExternalReading()
        statusText.text = when {
            labMode && state.anomaly -> "SUSTAINED DISAGREEMENT • $confidence%"
            labMode && state.candidateAnomaly -> "CANDIDATE • ${(state.consensusRatio * 100).roundToInt()}% CONSENSUS"
            state.anomaly -> "ANOMALOUS HUMAN-LIKE SIGNAL • $confidence%"
            state.humanLike && state.facePresent -> "HUMAN ${state.trackLabel ?: ""} • $confidence%$dist"
            state.humanLike -> "HUMAN-LIKE ${state.trackLabel ?: ""} • $confidence%$dist"
            extNow?.detected == true -> "${extNow.sensorType} PRESENCE • ${(extNow.confidence * 100).roundToInt()}%"
            else -> "SCANNING • NO STRONG PRESENCE"
        }
        statusText.setTextColor(
            when {
                state.anomaly -> Brand.MAGENTA
                state.humanLike -> Brand.GREEN
                state.candidateAnomaly -> Brand.AMBER
                extNow?.detected == true -> Brand.AMBER
                else -> Color.WHITE
            }
        )
        detailText.text = if (labMode) {
            "${currentProfile.label.uppercase()}  POSE ${state.strongLandmarks}/33  STAB ${(state.trackStability * 100).roundToInt()}%  " +
                "CONS ${state.consensusPositiveFrames}/${state.consensusWindowFrames}  Q ${(state.sceneQuality.score * 100).roundToInt()}%  " +
                "V ${(state.fusion.vision * 100).roundToInt()} F ${(state.fusion.face * 100).roundToInt()} " +
                "S ${(state.fusion.field * 100).roundToInt()} X ${(state.fusion.external * 100).roundToInt()}"
        } else {
            "VISION ${(state.bodyScore * 100).roundToInt()}%  •  FUSED $confidence%  •  ${currentProfile.label.uppercase()}"
        }
    }

    private fun updateSensorText(s: SensorSnapshot) {
        fun f(value: Float?, suffix: String, digits: Int = 0): String =
            value?.let { if (digits == 1) "%.1f%s".format(it, suffix) else "%.0f%s".format(it, suffix) } ?: "--"

        sensorText.text = buildString {
            append("MAG ").append(f(s.magneticMicroTesla, "µT"))
            append("  LIGHT ").append(f(s.lightLux, "lx"))
            append("  AUDIO ").append(f(s.audioDbfs, "dB", 1))
            if (labMode) append("  PRESS ").append(f(s.pressureHpa, "hPa", 1))
        }
        if (!torchEnabled && s.lightLux != null && s.lightLux < 2f) {
            lightButton.text = "LOW LIGHT"
            lightButton.setTextColor(Brand.AMBER)
        } else if (!torchEnabled) {
            lightButton.text = "LIGHT"
            lightButton.setTextColor(Brand.CYAN)
        }
    }

    private fun maybeAutoCapture(state: DetectionState) {
        if (!operatorPreferences.autoCaptureEnabled) return
        val now = SystemClock.elapsedRealtime()
        if (now - lastAutoCaptureAt < currentProfile.autoCaptureCooldownMs) return
        lastAutoCaptureAt = now
        runOnUiThread {
            vibrateDetection()
            captureEvent("auto_anomaly", state, true)
        }
    }

    private fun captureEvent(reason: String, state: DetectionState, automatic: Boolean) {
        if (!::cameraController.isInitialized) return

        try {
            val eventElapsed = SystemClock.elapsedRealtime()
            val interruptionGeneration = captureInterruptionGeneration
            val captureSessionId = sessionRecorder.currentSessionId
            val captureEpochMs = System.currentTimeMillis()
            val bundle = eventRepository.createEventBundle(reason)
            val completion = CaptureCompletion { videoStatus ->
                submitIo {
                    java.io.File(bundle, "capture_status.json").writeText(org.json.JSONObject().apply {
                        put("state", "sealed")
                        put("video", videoStatus)
                        put("lifecycleInterrupted", interruptionGeneration != captureInterruptionGeneration)
                        put("sealedEpochMs", System.currentTimeMillis())
                    }.toString(2))
                    EvidenceIntegrity.refreshManifest(bundle, Brand.VERSION)
                    EvidenceSigner.signIntegrityManifest(bundle)
                    runOnUiThread { if (!isDestroyed) bufferText.text = "EVENT SEALED: ${bundle.name}" }
                }
            }
            if (rollingBuffer == null) completion.videoReady("unavailable")
            else rollingBuffer?.markEvent(bundle) { completion.videoReady(it) }
            val file = eventRepository.newImageFile(reason, bundle)
            val preTelemetry = sensorTimeline.window(eventElapsed, 30_000L, 0L)
            sensorTimeline.writeCsv(java.io.File(bundle, "telemetry_pre.csv"), preTelemetry)
            val preDetections = detectionTimeline.window(eventElapsed, 30_000L, 0L)
            detectionTimeline.writeJsonl(java.io.File(bundle, "detections_pre.jsonl"), preDetections)

            val options = ImageCapture.OutputFileOptions.Builder(file).build()
            cameraController.takePicture(
                options,
                ioExecutor,
                object : ImageCapture.OnImageSavedCallback {
                    override fun onImageSaved(outputFileResults: ImageCapture.OutputFileResults) {
                        try {
                            val s = sensorSnapshot
                            val event = ScanEvent(
                                timestampEpochMs = captureEpochMs,
                                type = reason,
                                confidence = (state.fusedScore * 100f).roundToInt(),
                                trackLabel = state.trackLabel,
                                estimatedDistanceMetres = state.estimatedDistanceMetres,
                                magneticMicroTesla = s.magneticMicroTesla,
                                lightLux = s.lightLux,
                                pressureHpa = s.pressureHpa,
                                audioDbfs = s.audioDbfs,
                                note = if (automatic) "automatic detector-disagreement capture" else "manual capture",
                                anomalyReason = state.anomalyReason,
                                profile = currentProfile.label,
                                bundleName = bundle.name,
                                sceneQualityPercent = (state.sceneQuality.score * 100f).roundToInt(),
                                consensusRatio = state.consensusRatio,
                                consensusAgeMs = state.consensusAgeMs,
                                explanationSummary = state.explanation.summary,
                                sessionId = captureSessionId
                            )
                            eventRepository.append(event)
                            eventRepository.writeBundleMetadata(bundle, event)
                            java.io.File(bundle, "explanation.json").writeText(state.explanation.toJson().toString(2))
                            sessionRecorder.markEvent(bundle.name, state)
                            completion.imageReady()
                            // This work belongs to the capture, not the Activity's Handler.
                            // It survives rotation and waits for video finalization before sealing.
                            ioExecutor.schedule({
                                try {
                                    val fullWindow = sensorTimeline.window(eventElapsed, 30_000L, 10_000L)
                                    sensorTimeline.writeCsv(java.io.File(bundle, "telemetry_window.csv"), fullWindow)
                                    val detectionWindow = detectionTimeline.window(eventElapsed, 30_000L, 10_000L)
                                    detectionTimeline.writeJsonl(java.io.File(bundle, "detections_window.jsonl"), detectionWindow)
                                    completion.windowReady()
                                } catch (error: Exception) {
                                    completion.fail()
                                    runOnUiThread { if (!isDestroyed) bufferText.text = "CAPTURE INCOMPLETE: ${error.message}" }
                                }
                            }, 10_500L, java.util.concurrent.TimeUnit.MILLISECONDS)
                            runOnUiThread { if (!isDestroyed) bufferText.text = "EVENT SAVING POST-WINDOW: ${bundle.name}" }
                        } catch (error: Exception) {
                            completion.fail()
                            runOnUiThread { if (!isDestroyed) bufferText.text = "CAPTURE INCOMPLETE: ${error.message}" }
                        }
                    }

                    override fun onError(exception: ImageCaptureException) {
                        completion.fail()
                        runOnUiThread { bufferText.text = "CAPTURE FAILED: ${exception.message ?: "unknown"}" }
                    }
                }
            )
        } catch (error: Exception) {
            bufferText.text = "CAPTURE FAILED: ${error.message ?: error.javaClass.simpleName}"
        }
    }

    private fun toggleLabMode() {
        labMode = !labMode
        modeButton.text = if (labMode) "LAB" else "FIELD"
        modeButton.setTextColor(if (labMode) Brand.AMBER else Brand.CYAN)
        renderDetection(latestDetection)
        updateSensorText(sensorSnapshot)
    }

    private fun toggleTorch() {
        if (!::cameraController.isInitialized) return
        torchEnabled = !torchEnabled
        try {
            cameraController.enableTorch(torchEnabled)
            lightButton.text = if (torchEnabled) "LIGHT ON" else "LIGHT"
            lightButton.setTextColor(if (torchEnabled) Brand.AMBER else Brand.CYAN)
        } catch (_: Throwable) {
            torchEnabled = false
            Toast.makeText(this, "Torch unavailable on this camera", Toast.LENGTH_SHORT).show()
        }
    }

    private fun freshExternalReading(maxAgeMs: Long = 3_000L): ExternalPresenceReading? {
        val reading = externalReading ?: return null
        return reading.takeIf { System.currentTimeMillis() - it.receivedEpochMs <= maxAgeMs }
    }

    private fun showRadarInfo() {
        val currentExternal = freshExternalReading()
        val message = if (currentExternal?.detected == true) {
            "External ${currentExternal.source}: presence ${(currentExternal.confidence * 100).roundToInt()}%"
        } else {
            "Phone vision cannot see through walls. SenseVeil's RADAR input is ready for a compatible BLE/USB mmWave sensor."
        }
        Toast.makeText(this, message, Toast.LENGTH_LONG).show()
    }

    private fun showToolsPanel() {
        val root = findViewById<ViewGroup>(android.R.id.content)
        val shade = FrameLayout(this).apply {
            setBackgroundColor(0xE6000000.toInt())
            isClickable = true
        }
        val panel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(18), dp(16), dp(18), dp(16))
            background = roundedPanel(0xFF10161D.toInt())
        }
        panel.addView(TextView(this).apply {
            text = "SENSEVEIL TOOLS • v${Brand.VERSION}"
            setTextColor(Brand.CYAN)
            textSize = 18f
            setTypeface(Typeface.MONOSPACE, Typeface.BOLD)
        })
        panel.addView(TextView(this).apply {
            text = "Profile controls detection thresholds. Calibration resets environmental baselines. Device Support reports hardware only; it does not imply through-wall imaging."
            setTextColor(Brand.TEXT_MUTED)
            textSize = 11f
            setPadding(0, dp(8), 0, dp(10))
        })

        fun toolButton(label: String, action: () -> Unit) {
            panel.addView(compactButton(label) { action() }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48)).apply {
                setMargins(0, dp(3), 0, dp(3))
            })
        }

        toolButton("PROFILE: ${currentProfile.label.uppercase()}") {
            currentProfile = currentProfile.next()
            consensusGate.reset()
            anomalyEpisodeLatched = false
            profileStore.current = currentProfile
            root.removeView(shade)
            bufferText.text = "PROFILE: ${currentProfile.label.uppercase()}"
            renderDetection(latestDetection)
            showToolsPanel()
        }
        toolButton("CALIBRATE FIELD BASELINES") {
            sensorFusion.resetBaselines()
            bufferText.text = "CALIBRATING • HOLD PHONE STEADY"
            mainHandler.postDelayed({ bufferText.text = "CALIBRATION BASELINE READY" }, 3_000L)
        }
        toolButton("AUDIO MONITOR: ${if (audioMonitoringEnabled) "ON" else "OFF"}") { toggleAudioMonitoring() }
        toolButton("ALERT: ${alertMode.label.uppercase()}") {
            alertMode = alertMode.next()
            alertPolicyStore.mode = alertMode
            root.removeView(shade)
            bufferText.text = "ALERT MODE: ${alertMode.label.uppercase()}"
            showToolsPanel()
        }
        toolButton("AUTO CAPTURE: ${if (operatorPreferences.autoCaptureEnabled) "ON" else "OFF"}") {
            operatorPreferences.autoCaptureEnabled = !operatorPreferences.autoCaptureEnabled
            root.removeView(shade)
            showToolsPanel()
        }
        toolButton("PERFORMANCE: ${operatorPreferences.performanceMode.label.uppercase()}") {
            operatorPreferences.performanceMode = operatorPreferences.performanceMode.next()
            rollingBuffer?.setPerformanceMode(operatorPreferences.performanceMode)
            root.removeView(shade)
            showToolsPanel()
        }
        toolButton("TRUST LAST IMPORTED SIGNER") { trustLastImportedSigner() }
        toolButton("TRUSTED SIGNERS") { showTextPanel("TRUSTED SIGNERS", trustedSignerStore.render()) }
        toolButton("DEVICE SUPPORT") { showDeviceSupport() }
        toolButton("DEVICE HEALTH") { showDeviceHealth() }
        toolButton("AR DEPTH SUPPORT") { showArDepthSupport() }
        toolButton("DEVICE SIGNER ID") { showSignerIdentity() }
        toolButton("QUICK START") {
            FirstRunGuide.markSeen(this)
            showTextPanel("QUICK START", FirstRunGuide.text())
        }
        toolButton("CRASH DIAGNOSTICS") { showTextPanel("CRASH DIAGNOSTICS", CrashDiagnostics.lastCrashSummary(this)) }
        toolButton("EXPORT DIAGNOSTICS") { exportDiagnostics() }
        toolButton("SELF-TEST") { runSelfTest() }
        toolButton("EVIDENCE REVIEW") { showEvidenceReview() }
        toolButton("SENSOR ADAPTERS") { showSensorAdapters() }
        toolButton("SESSION REPLAY") { showSessionReplay() }
        toolButton("SECURE VAULT: ${if (securityPreferences.secureVaultEnabled) "ON" else "OFF"}") {
            securityPreferences.secureVaultEnabled = !securityPreferences.secureVaultEnabled
            root.removeView(shade)
            bufferText.text = "SECURE VAULT: ${if (securityPreferences.secureVaultEnabled) "ON" else "OFF"}"
            showToolsPanel()
        }
        toolButton("RETENTION: ${securityPreferences.retentionDays} DAYS") {
            securityPreferences.retentionDays = when (securityPreferences.retentionDays) {
                in 1..7 -> 30
                in 8..30 -> 90
                in 31..90 -> 365
                else -> 7
            }
            root.removeView(shade)
            showToolsPanel()
        }
        toolButton("VERIFY LAST EVIDENCE") { verifyLatestEvidence() }
        toolButton("VERIFY IMPORTED ZIP / SVE") { evidenceImportLauncher.launch(arrayOf("application/zip", "application/octet-stream")) }
        toolButton("EXPORT LAST EVIDENCE") { exportLatestEvidence() }
        toolButton("CLOSE") { root.removeView(shade) }

        val toolsScroll = ScrollView(this).apply { addView(panel); isFillViewport = true }
        shade.addView(toolsScroll, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT).apply {
            gravity = Gravity.CENTER
            setMargins(dp(18), dp(40), dp(18), dp(40))
        })
        root.addView(shade, matchParent())
    }

    private fun trustLastImportedSigner() {
        val fingerprint = lastImportedSignerFingerprint
        if (fingerprint.isNullOrBlank() || !lastImportedSignatureValid) {
            Toast.makeText(this, "Verify valid imported evidence first", Toast.LENGTH_SHORT).show()
            return
        }
        val local = runCatching { EvidenceSigner.localSignerFingerprint() }.getOrNull()
        if (local != null && local.equals(fingerprint, ignoreCase = true)) {
            bufferText.text = "SIGNER IS THIS DEVICE"
            return
        }
        if (trustedSignerStore.trust(fingerprint)) {
            bufferText.text = "SIGNER PINNED • ${fingerprint.take(12)}…"
        } else {
            bufferText.text = "SIGNER PIN FAILED"
        }
    }

    private fun toggleAudioMonitoring() {
        if (audioMonitoringEnabled) {
            audioMonitoringEnabled = false
            audioMonitor.stop()
            sensorFusion.setAudioDbfs(null)
            bufferText.text = "AUDIO MONITOR: OFF"
            return
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            audioMonitoringEnabled = true
            audioMonitor.start()
            bufferText.text = "AUDIO MONITOR: ON"
        } else {
            audioPermissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
        }
    }

    private fun showDeviceSupport() {
        val report = DeviceCapabilities.inspect(this).asText()
        val root = findViewById<ViewGroup>(android.R.id.content)
        val shade = FrameLayout(this).apply { setBackgroundColor(0xE6000000.toInt()) }
        val panel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(18), dp(16), dp(18), dp(16))
            background = roundedPanel(0xFF10161D.toInt())
        }
        panel.addView(TextView(this).apply {
            text = "DEVICE SUPPORT"
            setTextColor(Brand.CYAN)
            textSize = 18f
            setTypeface(Typeface.MONOSPACE, Typeface.BOLD)
        })
        panel.addView(TextView(this).apply {
            text = report
            setTextColor(0xFFD7E7ED.toInt())
            textSize = 12f
            setTypeface(Typeface.MONOSPACE, Typeface.NORMAL)
            setPadding(0, dp(10), 0, dp(12))
        })
        panel.addView(compactButton("CLOSE") { root.removeView(shade) }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48)))
        shade.addView(panel, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
            gravity = Gravity.CENTER
            setMargins(dp(18), dp(40), dp(18), dp(40))
        })
        root.addView(shade, matchParent())
    }


    private fun showDeviceHealth() {
        val health = DeviceHealthMonitor.inspect(this, eventRepository.eventRoot)
        showTextPanel("DEVICE HEALTH", health.asText())
    }

    private fun showArDepthSupport() {
        val cameraGranted = ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
        val report = ArDepthSupport.inspect(this, probeDepth = cameraGranted)
        showTextPanel(
            "AR DEPTH SUPPORT",
            report.asText() + "\n\nDepth remains optional and is never described as through-wall vision. " +
                "A dedicated AR camera mode would release CameraX before creating an ARCore session."
        )
    }

    private fun showSignerIdentity() {
        val fingerprint = runCatching { EvidenceSigner.localSignerFingerprint() }
            .getOrElse { error ->
                showTextPanel("DEVICE SIGNER ID", "Unable to read signing identity: ${error.message ?: "unknown error"}")
                return
            }
        showTextPanel(
            "DEVICE SIGNER ID",
            "ECDSA P-256 signing-key fingerprint (SHA-256):\n\n$fingerprint\n\n" +
                "Record this fingerprint somewhere independent if you want to recognise evidence " +
                "signed by this installation later. A valid signature proves integrity relative to " +
                "its signing key; it is not an external timestamp or identity certificate."
        )
    }

    private fun exportDiagnostics() {
        bufferText.text = "PACKAGING DIAGNOSTICS…"
        submitIo {
            runCatching { DiagnosticsBundle.create(this, operatorPreferences, securityPreferences) }
                .onSuccess { zip ->
                    runOnUiThread {
                        bufferText.text = "DIAGNOSTICS READY • NO EVIDENCE MEDIA INCLUDED"
                        DiagnosticsBundle.share(this, zip)
                        mainHandler.postDelayed({ zip.delete() }, 10 * 60 * 1000L)
                    }
                }
                .onFailure { err ->
                    runOnUiThread { bufferText.text = "DIAGNOSTICS FAILED: ${err.message ?: "unknown"}" }
                }
        }
    }

    private fun runSelfTest() {
        bufferText.text = "SELF-TEST • RUNNING"
        submitIo {
            val report = SenseVeilSelfTest.run(this, eventRepository)
            runOnUiThread {
                bufferText.text = if (report.passed) "SELF-TEST • PASS" else "SELF-TEST • ATTENTION"
                showTextPanel("SYSTEM SELF-TEST", report.asText())
            }
        }
    }

    private fun showEvidenceReview() {
        val body = EvidenceCatalog.render(eventRepository.eventRoot, limit = 12)
        showTextPanel("EVIDENCE REVIEW", body)
    }

    private fun showSensorAdapters() {
        val report = ExternalSensorDiscovery.report(this, externalHub, freshExternalReading())
        showTextPanel("SENSOR ADAPTERS", report)
    }

    private fun showSessionReplay() {
        val sessions = sessionRecorder.recentSessions()
        if (sessions.isEmpty()) { showTextPanel("SESSION REPLAY", "No recorded sessions yet."); return }
        androidx.appcompat.app.AlertDialog.Builder(this)
            .setTitle("Select a session")
            .setItems(sessions.toTypedArray()) { _, index -> renderSessionReplay(sessions[index]) }
            .setNegativeButton("Cancel", null).show()
    }

    private fun renderSessionReplay(sessionId: String) {
        val summary = sessionRecorder.latestSummary(sessionId)
        val replay = sessionRecorder.latestReplay(28, sessionId)
        val body = buildString {
            append(summary)
            if (replay.isNotEmpty()) {
                append("\n\nRECENT TIMELINE\n")
                replay.forEach { append(it).append('\n') }
            }
            append("\nReplay is a measurement timeline, not a reconstruction of unseen events.")
        }
        showTextPanel("SESSION REPLAY", body)
    }

    private fun showTextPanel(title: String, bodyText: String) {
        val root = findViewById<ViewGroup>(android.R.id.content)
        val shade = FrameLayout(this).apply {
            setBackgroundColor(0xE6000000.toInt())
            isClickable = true
        }
        val panel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(18), dp(16), dp(18), dp(16))
            background = roundedPanel(0xFF10161D.toInt())
        }
        panel.addView(TextView(this).apply {
            text = title
            setTextColor(Brand.CYAN)
            textSize = 18f
            setTypeface(Typeface.MONOSPACE, Typeface.BOLD)
        })
        val body = TextView(this).apply {
            text = bodyText
            setTextColor(0xFFD7E7ED.toInt())
            textSize = 11f
            setTypeface(Typeface.MONOSPACE, Typeface.NORMAL)
            setPadding(0, dp(10), 0, dp(12))
        }
        val scroll = ScrollView(this).apply { addView(body) }
        panel.addView(scroll, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        panel.addView(compactButton("CLOSE") { root.removeView(shade) }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48)))
        shade.addView(panel, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT).apply {
            gravity = Gravity.CENTER
            setMargins(dp(18), dp(50), dp(18), dp(50))
        })
        root.addView(shade, matchParent())
    }

    private fun verifyLatestEvidence() {
        val bundle = eventRepository.latestBundle()
        if (bundle == null) {
            Toast.makeText(this, "No evidence bundle saved yet", Toast.LENGTH_SHORT).show()
            return
        }
        submitIo {
            val verification = EvidenceVerifier.verifyBundle(bundle, requireLocalSigner = true)
            runOnUiThread {
                val body = buildString {
                    append(bundle.name).append('\n')
                    append("STATUS ").append(if (verification.valid) "VERIFIED" else "FAILED").append('\n')
                    append("FILES ").append(verification.checkedFiles).append('\n')
                    append("SIGNATURE ").append(if (verification.signatureValid) "CRYPTO VALID" else "INVALID/MISSING").append('\n')
                    append("TRUSTED LOCAL KEY ").append(if (verification.signerTrustedOnThisDevice) "YES" else "NO").append('\n')
                    verification.signerFingerprint?.let { append("SIGNER FP ").append(it.take(24)).append("…\n") }
                    append(verification.message)
                    if (verification.hashFailures.isNotEmpty()) {
                        append("\n\nFAILURES\n")
                        verification.hashFailures.take(20).forEach { append("• ").append(it).append('\n') }
                    }
                }
                showTextPanel("EVIDENCE VERIFY", body)
            }
        }
    }

    private fun exportLatestEvidence() {
        val bundle = eventRepository.latestBundle()
        if (bundle == null) {
            Toast.makeText(this, "No evidence bundle saved yet", Toast.LENGTH_SHORT).show()
            return
        }
        bufferText.text = "VERIFYING & PACKAGING EVIDENCE…"
        submitIo {
            try {
                val verification = EvidenceVerifier.verifyBundle(bundle, requireLocalSigner = true)
                check(verification.valid) { verification.message }

                val clearZip = EvidenceExporter.zipBundle(bundle, eventRepository.shareCacheFileFor(bundle))
                val vault = if (securityPreferences.secureVaultEnabled) {
                    SecureEvidenceVault.encryptFile(clearZip, eventRepository.secureVaultFileFor(bundle))
                } else null

                runOnUiThread {
                    bufferText.text = if (vault != null) {
                        "SIGNED • VAULTED • READY TO SHARE"
                    } else {
                        "SIGNED • READY TO SHARE"
                    }
                    EvidenceExporter.shareZip(this, clearZip)
                    mainHandler.postDelayed({ clearZip.delete() }, 10 * 60 * 1000L)
                }
            } catch (t: Throwable) {
                runOnUiThread { bufferText.text = "EXPORT FAILED: ${t.message ?: "unknown"}" }
            }
        }
    }

    private fun showHistory() {
        val root = findViewById<ViewGroup>(android.R.id.content)
        val shade = FrameLayout(this).apply {
            setBackgroundColor(0xE6000000.toInt())
            isClickable = true
        }
        val panel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(18), dp(16), dp(18), dp(16))
            background = roundedPanel(0xFF10161D.toInt())
        }
        panel.addView(TextView(this).apply {
            text = "SENSEVEIL EVENT LOG"
            setTextColor(Brand.CYAN)
            textSize = 18f
            setTypeface(Typeface.MONOSPACE, Typeface.BOLD)
        })

        val recent = eventRepository.recent(30)
        val body = TextView(this).apply {
            setTextColor(0xFFD7E7ED.toInt())
            textSize = 11f
            setTypeface(Typeface.MONOSPACE, Typeface.NORMAL)
            text = if (recent.isEmpty()) "No saved events yet." else recent.joinToString("\n\n") { event ->
                val distance = event.estimatedDistanceMetres?.let { "  ~%.1fm".format(it) } ?: ""
                val time = java.text.SimpleDateFormat("dd MMM HH:mm:ss", java.util.Locale.UK)
                    .format(java.util.Date(event.timestampEpochMs))
                buildString {
                    append(time).append("  ").append(event.type.uppercase()).append("  ")
                        .append(event.confidence).append("%  ").append(event.trackLabel ?: "--").append(distance).append('\n')
                    append("PROFILE ").append(event.profile ?: "--")
                    append("  Q ").append(event.sceneQualityPercent?.let { "$it%" } ?: "--")
                    append("  CONS ").append(event.consensusRatio?.let { "%.0f%%".format(it * 100f) } ?: "--")
                    append("  MAG ").append(event.magneticMicroTesla?.let { "%.1fµT".format(it) } ?: "--")
                    append("  AUDIO ").append(event.audioDbfs?.let { "%.1fdB".format(it) } ?: "--").append('\n')
                    if (!event.anomalyReason.isNullOrBlank()) append("WHY: ").append(event.anomalyReason).append('\n')
                    if (!event.explanationSummary.isNullOrBlank()) append("TRACE: ").append(event.explanationSummary).append('\n')
                    if (!event.sessionId.isNullOrBlank()) append("SESSION: ").append(event.sessionId).append('\n')
                    append(event.note)
                }
            }
        }
        val scroll = ScrollView(this).apply { addView(body) }
        panel.addView(scroll, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        val actions = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        actions.addView(compactButton("SHARE LAST") { exportLatestEvidence() }, LinearLayout.LayoutParams(0, dp(48), 1f).apply {
            setMargins(0, 0, dp(3), 0)
        })
        actions.addView(compactButton("CLOSE") { root.removeView(shade) }, LinearLayout.LayoutParams(0, dp(48), 1f))
        panel.addView(actions)

        shade.addView(
            panel,
            FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT).apply {
                setMargins(dp(18), dp(55), dp(18), dp(45))
            }
        )
        root.addView(shade, matchParent())
    }

    private fun vibrateDetection() {
        if (alertMode == AlertMode.SILENT) return
        sensorFusion.suppressMagnetometerFor(900L)
        val pattern = if (alertMode == AlertMode.STRONG_HAPTIC) longArrayOf(0L, 140L, 90L, 180L) else longArrayOf(0L, 120L)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val vibrator = (getSystemService(VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator
            val effect = if (pattern.size > 2) VibrationEffect.createWaveform(pattern, -1)
            else VibrationEffect.createOneShot(120L, VibrationEffect.DEFAULT_AMPLITUDE)
            vibrator.vibrate(effect)
        } else {
            @Suppress("DEPRECATION")
            val vibrator = getSystemService(VIBRATOR_SERVICE) as Vibrator
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val effect = if (pattern.size > 2) VibrationEffect.createWaveform(pattern, -1)
                else VibrationEffect.createOneShot(120L, VibrationEffect.DEFAULT_AMPLITUDE)
                vibrator.vibrate(effect)
            } else {
                @Suppress("DEPRECATION")
                vibrator.vibrate(pattern, -1)
            }
        }
    }

    private fun submitIo(action: () -> Unit) {
        if (ioExecutor.isShutdown) return
        ioExecutor.execute {
            try { action() } catch (error: Exception) {
                runOnUiThread { if (!isDestroyed) bufferText.text = "STORAGE / EVIDENCE ERROR: ${error.message ?: error.javaClass.simpleName}" }
            }
        }
    }

    private fun compactButton(label: String, action: () -> Unit): Button =
        Button(this).apply {
            text = label
            textSize = 12f
            minHeight = dp(48)
            minimumHeight = dp(48)
            setPadding(dp(4), dp(4), dp(4), dp(4))
            maxLines = 2
            setTextColor(Brand.CYAN)
            setTypeface(Typeface.MONOSPACE, Typeface.BOLD)
            background = roundedPanel(0xCC111820.toInt(), Brand.CYAN)
            setOnClickListener { action() }
            isAllCaps = false
        }

    private fun roundedPanel(color: Int, stroke: Int = 0x4456DDEB): GradientDrawable =
        GradientDrawable().apply {
            setColor(color)
            cornerRadius = dp(14).toFloat()
            setStroke(dp(1), stroke)
        }

    private fun matchParent() = FrameLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.MATCH_PARENT
    )

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).roundToInt()

    override fun onResume() {
        super.onResume()
        if (::sensorFusion.isInitialized) sensorFusion.start()
        if (::audioMonitor.isInitialized && audioMonitoringEnabled) audioMonitor.start()
        rollingBuffer?.start()
    }

    override fun onPause() {
        captureInterruptionGeneration++
        consensusGate.reset()
        anomalyEpisodeLatched = false
        rollingBuffer?.stop()
        if (::audioMonitor.isInitialized) audioMonitor.stop()
        if (::sensorFusion.isInitialized) sensorFusion.stop()
        super.onPause()
    }

    override fun onDestroy() {
        mainHandler.removeCallbacksAndMessages(null)
        rollingBuffer?.stop()
        if (::sessionRecorder.isInitialized) submitIo { sessionRecorder.stop() }
        externalHub.stop()
        if (::cameraController.isInitialized) cameraController.clearImageAnalysisAnalyzer()
        if (::poseDetector.isInitialized) poseDetector.close()
        if (::faceDetector.isInitialized) faceDetector.close()
        if (::objectDetector.isInitialized) objectDetector.close()
        analysisExecutor.shutdown()
        super.onDestroy()
    }
}
