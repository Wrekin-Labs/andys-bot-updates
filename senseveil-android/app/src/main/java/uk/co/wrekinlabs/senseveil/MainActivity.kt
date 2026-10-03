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
    private lateinit var captureStatusText: TextView
    private var lastManualCaptureAt = 0L
    private var cameraReady = false
    private var cameraProblem: String? = null
    private lateinit var modeButton: Button
    private lateinit var lightButton: Button
    private lateinit var captureButton: Button

    private lateinit var poseDetector: PoseDetector
    private lateinit var faceDetector: FaceDetector
    private lateinit var objectDetector: ObjectDetector

    private val analysisExecutor = EvidenceWork.analysisExecutor
    @Volatile private var analysisClosed = false
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
    private val rfTimeline = RfTimeline()
    private lateinit var sensorFusion: SensorFusionEngine
    private lateinit var audioMonitor: AudioLevelMonitor
    private lateinit var wifiRfBridge: WifiRfBridge
    private lateinit var phoneWifiSurvey: PhoneWifiSurvey
    private val trackState = PersonTrackState()

    private var rollingBuffer: RollingVideoBuffer? = null
    private var externalHub: ExternalSensorHub = NoExternalSensorHub()
    private var externalReading: ExternalPresenceReading? = null
    private var sensorSnapshot = SensorSnapshot()
    private var wifiRfReading = WifiRfReading()
    private var wifiSurveyReading = WifiSurveyReading()
    private var latestDetection = DetectionState()

    private var labMode = false
    private var torchEnabled = false
    private var audioMonitoringEnabled = false
    private var lastAutoCaptureAt = 0L
    private var anomalyEpisodeLatched = false
    @Volatile private var captureInterruptionGeneration = 0L
    private val localNetworkPermissionName = "android.permission.ACCESS_LOCAL_NETWORK"

    private val permissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { grants ->
            val cameraGranted = grants[Manifest.permission.CAMERA] == true ||
                ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
            if (cameraGranted) {
                startCamera()
                startRuntimeSensors()
            } else {
                showCameraPermissionState()
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

    private val wifiSurveyPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { grants ->
            val fineGranted = grants[Manifest.permission.ACCESS_FINE_LOCATION] == true ||
                ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
            operatorPreferences.wifiSurveyEnabled = fineGranted
            if (fineGranted && ::phoneWifiSurvey.isInitialized) {
                phoneWifiSurvey.start()
                bufferText.text = "WI-FI SURVEY: ON"
            } else {
                bufferText.text = "WI-FI SURVEY: PRECISE LOCATION PERMISSION NOT GRANTED"
            }
        }

    private val localNetworkPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            operatorPreferences.rfBridgeEnabled = granted
            if (granted && ::wifiRfBridge.isInitialized) {
                wifiRfBridge.start()
                bufferText.text = "RF BRIDGE: CONNECTING"
            } else {
                bufferText.text = "RF BRIDGE: LOCAL NETWORK PERMISSION NOT GRANTED"
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
        profileStore = ProfileStore(this)
        currentProfile = profileStore.current
        alertPolicyStore = AlertPolicyStore(this)
        alertMode = alertPolicyStore.mode
        sessionRecorder = SessionRecorder(this).also { it.start() }
        labMode = savedInstanceState?.getBoolean("labMode") ?: false
        audioMonitoringEnabled = savedInstanceState?.getBoolean("audioMonitoringEnabled") ?: false
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
        // Serialize housekeeping with evidence writes; active capture/session guards
        // also protect producers that finish after an Activity is recreated.
        submitIo {
            val recovered = SessionRecovery.recoverInterrupted(this)
            val retention = retentionManager.run(eventRepository.eventRoot)
            runOnUiThread {
                if (!isDestroyed) {
                    if (recovered.recoveredSessions > 0) bufferText.text = "RECOVERED ${recovered.recoveredSessions} INTERRUPTED SESSION(S)"
                    else if (retention.deletedItems > 0) bufferText.text = "HOUSEKEEPING: ${retention.deletedItems} OLD ITEM(S) REMOVED"
                }
            }
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
            showCameraPermissionState()
            permissionLauncher.launch(needed.toTypedArray())
        }
    }

    private fun buildUi() {
        val landscape = resources.configuration.orientation == android.content.res.Configuration.ORIENTATION_LANDSCAPE
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
            textSize = 17f
            maxLines = 1
            ellipsize = android.text.TextUtils.TruncateAt.END
            setTypeface(typeface, Typeface.BOLD)
        })
        brandCopy.addView(TextView(this).apply {
            text = "v${Brand.VERSION} • Field research"
            maxLines = 1
            ellipsize = android.text.TextUtils.TruncateAt.END
            setTextColor(Brand.TEXT_MUTED)
            textSize = 10f
        })
        brandBar.addView(brandCopy, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))

        modeButton = compactButton(if (labMode) "LAB" else "FIELD") { toggleLabMode() }
        brandBar.addView(modeButton, LinearLayout.LayoutParams(dp(if (resources.configuration.fontScale >= 1.3f) 86 else 70), ViewGroup.LayoutParams.WRAP_CONTENT).apply { setMargins(0, 0, dp(4), 0) })
        val toolsButton = compactButton("TOOLS") { showToolsPanel() }
        brandBar.addView(toolsButton, LinearLayout.LayoutParams(dp(if (resources.configuration.fontScale >= 1.3f) 86 else 70), ViewGroup.LayoutParams.WRAP_CONTENT))

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
            text = "Starting camera and sensors…"
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
            FrameLayout.LayoutParams(if (landscape) dp(resources.configuration.screenWidthDp - 178) else ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                gravity = Gravity.TOP
                setMargins(dp(10), dp(78), dp(10), 0)
            }
        )

        brandBar.addOnLayoutChangeListener { _, _, _, _, bottom, _, _, _, _ ->
            val lp = statusPanel.layoutParams as FrameLayout.LayoutParams
            val target = bottom + dp(6)
            if (lp.topMargin != target) { lp.topMargin = target; statusPanel.layoutParams = lp }
        }
        radarView = RadarView(this).apply { background = roundedPanel(0xAA0B1015.toInt()) }
        statusPanel.addOnLayoutChangeListener { _, _, top, _, bottom, _, _, _, _ ->
            val lp = radarView.layoutParams as? FrameLayout.LayoutParams ?: return@addOnLayoutChangeListener
            val target = if (landscape) top else bottom + dp(6)
            if (lp.topMargin != target) { lp.topMargin = target; radarView.layoutParams = lp }
        }
        root.addView(
            radarView,
            FrameLayout.LayoutParams(dp(if (landscape) 148 else 158), dp(if (landscape) 100 else 126)).apply {
                gravity = Gravity.END or Gravity.TOP
                setMargins(0, dp(if (landscape) 78 else 145), dp(10), 0)
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

        captureStatusText = TextView(this).apply {
            text = "Starting camera…"
            textSize = 12f
            setTextColor(Brand.GREEN)
            accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE
            setPadding(0, dp(4), 0, dp(4))
        }
        val buttonRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
        }
        captureButton = compactButton("CAPTURE") {
            when {
                !hasCameraPermission() -> showCameraAccess()
                cameraProblem != null -> recreate()
                cameraReady -> captureEvent("manual", latestDetection, false)
            }
        }
        val events = compactButton("EVENTS") { showHistory() }
        lightButton = compactButton("LIGHT") { toggleTorch() }
        val wall = compactButton("RADAR") { showRadarInfo() }

        listOf(captureButton, events, lightButton, wall).forEach {
            buttonRow.addView(it, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { setMargins(dp(2), 0, dp(2), 0) })
        }

        val disclaimer = TextView(this).apply {
            setTextColor(0xFF8799A3.toInt())
            textSize = 10f
            text = "AI scores are estimates, not proof of a cause. Radar requires external hardware."
            contentDescription = "AI scores are estimates, not proof of a paranormal cause. The phone camera cannot see through walls. Radar requires external hardware."
        }

        bottomPanel.addView(sensorText)
        bottomPanel.addView(bufferText)
        bottomPanel.addView(captureStatusText)
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
        wifiRfBridge = WifiRfBridge(this, operatorPreferences) { reading ->
            wifiRfReading = reading
            rfTimeline.addRf(reading)
            runOnUiThread {
                updateSensorText(sensorSnapshot)
                if (reading.sustainedChange) bufferText.text = "RF CHANGE RECORDED • " + (reading.source ?: "bridge")
            }
        }
        phoneWifiSurvey = PhoneWifiSurvey(this) { reading ->
            wifiSurveyReading = reading
            rfTimeline.addSurvey(reading)
            runOnUiThread { updateSensorText(sensorSnapshot) }
        }
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
        startOptionalWifiFeatures()
    }

    private fun startOptionalWifiFeatures() {
        if (::phoneWifiSurvey.isInitialized && operatorPreferences.wifiSurveyEnabled && hasWifiSurveyPermission()) {
            phoneWifiSurvey.start()
        }
        if (::wifiRfBridge.isInitialized && operatorPreferences.rfBridgeEnabled && hasLocalNetworkPermission()) {
            wifiRfBridge.start()
        }
    }

    private fun startCamera() {
        if (::cameraController.isInitialized) return
        cameraReady = false
        cameraProblem = null
        refreshCaptureStatus()

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

        val poseProjection = PoseProjection()
        cameraController.setImageAnalysisAnalyzer(
            analysisExecutor,
            poseProjection.wrap(MlKitAnalyzer(
                listOf(poseDetector, faceDetector, objectDetector),
                ImageAnalysis.COORDINATE_SYSTEM_VIEW_REFERENCED,
                analysisExecutor
            ) analyze@ { result ->
                if (analysisClosed) return@analyze
                val rawPose = result.getValue(poseDetector)
                val pose = poseProjection.project(rawPose, result.timestamp)
                val faces = result.getValue(faceDetector).orEmpty()
                val objects = result.getValue(objectDetector).orEmpty()

                val objectLabels = objects.flatMap { it.labels }.map { it.text }.filter { it.isNotBlank() }.distinct().take(3)
                val landmarks = rawPose?.allPoseLandmarks.orEmpty()
                val strongLandmarks = landmarks.count { it.inFrameLikelihood >= 0.55f }
                val averageLikelihood = if (landmarks.isEmpty()) 0f else
                    landmarks.map { it.inFrameLikelihood.toDouble() }.average().toFloat()

                val bodyScore = (
                    (strongLandmarks / 33f) * 0.65f + averageLikelihood * 0.35f
                    ).coerceIn(0f, 1f)

                val profile = currentProfile
                val lowLight = sensorSnapshot.lightLux?.let { it < 1.5f } == true && !torchEnabled
                val deviceMoving = sensorSnapshot.accelerationMs2?.let { abs(it - 9.81f) > 1.8f } == true
                if (::wifiRfBridge.isInitialized) wifiRfBridge.setDeviceMoving(deviceMoving)
                val lowLightPenalty = if (lowLight) 0.06f else 0f
                val humanLike = strongLandmarks >= profile.minLandmarks &&
                    bodyScore >= (profile.humanBodyThreshold + lowLightPenalty)
                val facePresent = faces.isNotEmpty()
                val track = trackState.update(humanLike)
                val distance = DistanceEstimator.estimateFromPose(pose, faces, previewView.width, previewView.height)
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
                    estimatedDistanceMetres = if (humanLike) distance else ext?.takeIf { it.detected }?.distanceMetres,
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
                runCatching { sessionRecorder.append(state, sensorSnapshot, ext, wifiRfReading, wifiSurveyReading) }.onFailure { error ->
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
            })
        )

        previewView.controller = cameraController
        try {
            cameraController.bindToLifecycle(this)
        } catch (_: Exception) {
            videoEnabled = false
            cameraController.setEnabledUseCases(CameraController.IMAGE_CAPTURE or CameraController.IMAGE_ANALYSIS)
            try { cameraController.bindToLifecycle(this) } catch (error: Exception) {
                showCameraFailure(error)
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
                cameraReady = true
                refreshCaptureStatus()
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
                showCameraFailure(error)
            }
        }, ContextCompat.getMainExecutor(this))
    }

    private fun renderDetection(state: DetectionState) {
        val confidence = (state.fusedScore * 100f).roundToInt()
        // A shoulder-size guess is deliberately not promoted to a measured range in Field mode.
        val dist = if (labMode && state.humanLike) state.estimatedDistanceMetres?.let {
            " • ~%.1fm ROUGH".format((it * 2).roundToInt() / 2f)
        } ?: "" else ""
        val extNow = freshExternalReading()
        statusText.text = when {
            labMode && state.anomaly -> "SUSTAINED DISAGREEMENT • $confidence%"
            labMode && state.candidateAnomaly -> "CANDIDATE • ${(state.consensusRatio * 100).roundToInt()}% CONSENSUS"
            state.anomaly -> "ANOMALOUS HUMAN-LIKE SIGNAL • $confidence%"
            state.humanLike && state.facePresent -> "PERSON ${state.trackLabel ?: ""}$dist"
            state.humanLike -> "HUMAN-LIKE ${state.trackLabel ?: ""}$dist"
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
            "Fusion score $confidence% • ${currentProfile.label}\n" +
                if (state.humanLike) "Visual tracking • range unmeasured" else "Hold steady • watch for changes"
        }
    }

    private fun updateSensorText(s: SensorSnapshot) {
        refreshCaptureStatus()
        fun f(value: Float?, suffix: String, digits: Int = 0): String =
            value?.let { if (digits == 1) "%.1f%s".format(it, suffix) else "%.0f%s".format(it, suffix) } ?: "--"

        sensorText.text = buildString {
            append("MAG ").append(f(s.magneticMicroTesla, "µT"))
            append("  LIGHT ").append(f(s.lightLux, "lx"))
            append("  AUDIO ").append(f(s.audioDbfs, "dB", 1))
            if (labMode) append("  PRESS ").append(f(s.pressureHpa, "hPa", 1))
            if (operatorPreferences.rfBridgeEnabled) {
                append("\nRF ").append(wifiRfReading.status.name)
                if (wifiRfReading.sampleRateHz != null) append(" ").append("%.1fHz".format(wifiRfReading.sampleRateHz))
                if (wifiRfReading.novelty > 0f) append(" Δ").append((wifiRfReading.novelty * 100f).roundToInt()).append('%')
            }
            if (operatorPreferences.wifiSurveyEnabled) {
                append("  WIFI ").append(wifiSurveyReading.visibleNetworks).append(" AP")
            }
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
        if (!lifecycle.currentState.isAtLeast(androidx.lifecycle.Lifecycle.State.RESUMED)) return
        if (!cameraReady || !hasCameraPermission() || !::cameraController.isInitialized) return
        val now = SystemClock.elapsedRealtime()
        if (!automatic && now - lastManualCaptureAt < 900L) return
        if (!automatic) lastManualCaptureAt = now
        var pendingBundleName: String? = null
        try {
            val eventElapsed = SystemClock.elapsedRealtime()
            val interruptionGeneration = captureInterruptionGeneration
            val captureSessionId = sessionRecorder.currentSessionId
            val captureEpochMs = System.currentTimeMillis()
            val capturedSensors = sensorSnapshot
            val capturedRf = wifiRfReading
            val capturedWifiSurvey = wifiSurveyReading
            val capturedProfile = currentProfile.label
            val bundle = eventRepository.createEventBundle(reason)
            pendingBundleName = bundle.name
            CaptureProgress.started(bundle.name)
            refreshCaptureStatus()
            val completion = CaptureCompletion { videoStatus ->
                submitIo {
                    try {
                    java.io.File(bundle, "capture_status.json").writeText(org.json.JSONObject().apply {
                        put("state", "sealed")
                        put("video", videoStatus)
                        put("lifecycleInterrupted", interruptionGeneration != captureInterruptionGeneration)
                        put("sealedEpochMs", System.currentTimeMillis())
                    }.toString(2))
                    EvidenceIntegrity.refreshManifest(bundle, Brand.VERSION)
                    EvidenceSigner.signIntegrityManifest(bundle)
                    CaptureProgress.sealed(bundle.name)
                    runOnUiThread { if (!isDestroyed) refreshCaptureStatus() }
                    } catch (error: Exception) {
                        CaptureProgress.failed(bundle.name)
                        throw error
                    }
                }
            }
            if (rollingBuffer == null) completion.videoReady("unavailable")
            else rollingBuffer?.markEvent(bundle) { completion.videoReady(it) }
            val file = eventRepository.newImageFile(reason, bundle)
            val preTelemetry = sensorTimeline.window(eventElapsed, 30_000L, 0L)
            sensorTimeline.writeCsv(java.io.File(bundle, "telemetry_pre.csv"), preTelemetry)
            val preDetections = detectionTimeline.window(eventElapsed, 30_000L, 0L)
            detectionTimeline.writeJsonl(java.io.File(bundle, "detections_pre.jsonl"), preDetections)
            rfTimeline.writeCsv(java.io.File(bundle, "rf_pre.csv"), rfTimeline.window(eventElapsed, 30_000L, 0L))

            val options = ImageCapture.OutputFileOptions.Builder(file).build()
            cameraController.takePicture(
                options,
                ioExecutor,
                object : ImageCapture.OnImageSavedCallback {
                    override fun onImageSaved(outputFileResults: ImageCapture.OutputFileResults) {
                        try {
                            val s = capturedSensors
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
                                rfStatus = capturedRf.status.name,
                                rfSource = capturedRf.source,
                                rfNovelty = capturedRf.novelty,
                                rfSustainedChange = capturedRf.sustainedChange,
                                rfSampleRateHz = capturedRf.sampleRateHz,
                                rfRssiDbm = capturedRf.rssiDbm,
                                rfCsiAmplitude = capturedRf.csiAmplitude,
                                rfCsiVariance = capturedRf.csiVariance,
                                wifiVisibleNetworks = capturedWifiSurvey.visibleNetworks.takeIf { operatorPreferences.wifiSurveyEnabled },
                                wifiStrongestRssiDbm = capturedWifiSurvey.strongestRssiDbm,
                                wifiMedianRssiDbm = capturedWifiSurvey.medianRssiDbm,
                                note = if (automatic) "automatic detector-disagreement capture" else "manual capture",
                                anomalyReason = state.anomalyReason,
                                profile = capturedProfile,
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
                                    rfTimeline.writeCsv(java.io.File(bundle, "rf_window.csv"), rfTimeline.window(eventElapsed, 30_000L, 10_000L))
                                    completion.windowReady()
                                } catch (error: Exception) {
                                    completion.fail()
                                    CaptureProgress.failed(bundle.name)
                                    runOnUiThread { if (!isDestroyed) bufferText.text = "CAPTURE INCOMPLETE: ${error.message}" }
                                }
                            }, 10_500L, java.util.concurrent.TimeUnit.MILLISECONDS)
                            runOnUiThread { if (!isDestroyed) refreshCaptureStatus() }
                        } catch (error: Exception) {
                            completion.fail()
                            CaptureProgress.failed(bundle.name)
                            runOnUiThread { if (!isDestroyed) bufferText.text = "CAPTURE INCOMPLETE: ${error.message}" }
                        }
                    }

                    override fun onError(exception: ImageCaptureException) {
                        completion.fail()
                        CaptureProgress.failed(bundle.name)
                        runOnUiThread { bufferText.text = "CAPTURE FAILED: ${exception.message ?: "unknown"}" }
                    }
                }
            )
        } catch (error: Exception) {
            pendingBundleName?.let { CaptureProgress.failed(it) }
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
            panel.addView(compactButton(label) { action() }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                setMargins(0, dp(3), 0, dp(3))
            })
        }

        fun toolSection(title: String) {
            panel.addView(TextView(this).apply {
                text = title; textSize = 15f; setTextColor(Color.WHITE)
                setTypeface(typeface, Typeface.BOLD); setPadding(0, dp(16), 0, dp(5))
            })
        }
        toolSection("Scanning & capture")
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
        toolSection("Wi-Fi / RF sensing (opt-in)")
        panel.addView(TextView(this).apply {
            text = "Wi-Fi surveys store aggregate signal counts only. CSI/RF records environmental radio change and never feeds person-detection confidence."
            setTextColor(Brand.TEXT_MUTED)
            textSize = 11f
            setPadding(0, dp(2), 0, dp(6))
        })
        toolButton("WI-FI SURVEY: " + if (operatorPreferences.wifiSurveyEnabled) "ON" else "OFF") {
            root.removeView(shade)
            toggleWifiSurvey()
        }
        toolButton("RF BRIDGE: " + if (operatorPreferences.rfBridgeEnabled) "ON" else "OFF") {
            root.removeView(shade)
            toggleRfBridge()
        }
        toolButton("RF BRIDGE SETUP") {
            root.removeView(shade)
            showRfBridgeSetup()
        }
        toolButton("RF BASELINE RESET") {
            wifiRfBridge.resetBaseline()
            bufferText.text = "RF BASELINE RESET • HOLD PHONE STILL"
        }
        toolButton("RF STATUS") {
            root.removeView(shade)
            showRfStatus()
        }
        toolSection("Signer trust")
        toolButton("TRUST LAST IMPORTED SIGNER") { trustLastImportedSigner() }
        toolButton("TRUSTED SIGNERS") { showTextPanel("TRUSTED SIGNERS", trustedSignerStore.render()) }
        toolSection("Device & help")
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
        toolSection("Evidence & sessions")
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

    private fun toggleWifiSurvey() {
        if (operatorPreferences.wifiSurveyEnabled) {
            operatorPreferences.wifiSurveyEnabled = false
            phoneWifiSurvey.stop()
            wifiSurveyReading = WifiSurveyReading(status = "off")
            bufferText.text = "WI-FI SURVEY: OFF"
            updateSensorText(sensorSnapshot)
            return
        }
        if (hasWifiSurveyPermission()) {
            operatorPreferences.wifiSurveyEnabled = true
            phoneWifiSurvey.start()
            bufferText.text = "WI-FI SURVEY: ON"
        } else {
            wifiSurveyPermissionLauncher.launch(
                arrayOf(Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION)
            )
        }
    }

    private fun toggleRfBridge() {
        if (operatorPreferences.rfBridgeEnabled) {
            operatorPreferences.rfBridgeEnabled = false
            wifiRfBridge.stop()
            bufferText.text = "RF BRIDGE: OFF"
            updateSensorText(sensorSnapshot)
            return
        }
        if (hasLocalNetworkPermission()) {
            operatorPreferences.rfBridgeEnabled = true
            wifiRfBridge.start()
            bufferText.text = "RF BRIDGE: CONNECTING"
        } else if (Build.VERSION.SDK_INT >= 37) {
            localNetworkPermissionLauncher.launch(localNetworkPermissionName)
        }
    }

    private fun showRfBridgeSetup() {
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(8), dp(20), 0)
        }
        val host = android.widget.EditText(this).apply {
            hint = "Bridge host or IP"
            setText(operatorPreferences.rfBridgeHost)
            setSingleLine(true)
        }
        val port = android.widget.EditText(this).apply {
            hint = "Port"
            inputType = android.text.InputType.TYPE_CLASS_NUMBER
            setText(operatorPreferences.rfBridgePort.toString())
            setSingleLine(true)
        }
        val pair = TextView(this).apply {
            text = "Pair code: " + operatorPreferences.rfPairCode + "\nUse this exact code in the ESP32/PC bridge. It prevents accidental cross-feed; it is not transport encryption."
            setPadding(0, dp(12), 0, 0)
        }
        box.addView(host)
        box.addView(port)
        box.addView(pair)
        androidx.appcompat.app.AlertDialog.Builder(this)
            .setTitle("RF bridge setup")
            .setMessage("Enter the local CSI bridge endpoint. Android 17 asks for Local Network access only when RF bridge sensing is enabled.")
            .setView(box)
            .setPositiveButton("Save") { _, _ ->
                operatorPreferences.rfBridgeHost = host.text.toString()
                operatorPreferences.rfBridgePort = port.text.toString().toIntOrNull() ?: 8765
                if (operatorPreferences.rfBridgeEnabled) {
                    wifiRfBridge.stop()
                    if (hasLocalNetworkPermission()) wifiRfBridge.start()
                }
                bufferText.text = "RF BRIDGE ENDPOINT SAVED"
            }
            .setNeutralButton("New pair code") { _, _ ->
                val code = operatorPreferences.regenerateRfPairCode()
                if (operatorPreferences.rfBridgeEnabled) {
                    wifiRfBridge.stop()
                    if (hasLocalNetworkPermission()) wifiRfBridge.start()
                }
                showTextPanel("NEW RF PAIR CODE", code + "\n\nUpdate the ESP32/PC bridge to use this code.")
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun showRfStatus() {
        val rf = wifiRfReading
        val wifi = wifiSurveyReading
        showTextPanel(
            "WI-FI / RF STATUS",
            buildString {
                append("RF bridge: ").append(if (operatorPreferences.rfBridgeEnabled) "enabled" else "off").append('\n')
                append("Endpoint: ").append(operatorPreferences.rfBridgeHost).append(':').append(operatorPreferences.rfBridgePort).append('\n')
                append("State: ").append(rf.status.name).append('\n')
                append("Source: ").append(rf.source ?: "--").append('\n')
                append("Sample rate: ").append(rf.sampleRateHz?.let { "%.1f Hz".format(it) } ?: "--").append('\n')
                append("Novelty: ").append("%.0f%%".format(rf.novelty * 100f)).append('\n')
                append("Sustained RF change: ").append(rf.sustainedChange).append('\n')
                append("Detail: ").append(rf.message).append("\n\n")
                append("Phone Wi-Fi survey: ").append(if (operatorPreferences.wifiSurveyEnabled) "enabled" else "off").append('\n')
                append("Visible networks: ").append(wifi.visibleNetworks).append('\n')
                append("Strongest RSSI: ").append(wifi.strongestRssiDbm?.let { it.toString() + " dBm" } ?: "--").append('\n')
                append("Median RSSI: ").append(wifi.medianRssiDbm?.let { it.toString() + " dBm" } ?: "--").append('\n')
                append("Bands: 2.4GHz ").append(wifi.band24Count).append(" • 5GHz ").append(wifi.band5Count).append(" • 6GHz ").append(wifi.band6Count).append("\n\n")
                append("RF variation is environmental evidence only. SenseVeil does not infer a person or image through a wall from Wi-Fi/CSI.")
            }
        )
    }

    private fun showDeviceSupport() {
        showTextPanel("DEVICE SUPPORT", DeviceCapabilities.inspect(this).asText())
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
        bufferText.text = "CHECKING EVIDENCE…"
        submitIo {
            val body = EvidenceCatalog.render(eventRepository.eventRoot, limit = 12)
            runOnUiThread { if (!isDestroyed) showTextPanel("EVIDENCE REVIEW", body) }
        }
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
        bufferText.text = "READING SESSION…"
        submitIo {
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
            runOnUiThread { if (!isDestroyed) showTextPanel("SESSION REPLAY", body) }
        }
    }

    private fun showTextPanel(title: String, bodyText: String, photoFile: java.io.File? = null) {
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
            textSize = 14f
            setTypeface(Typeface.MONOSPACE, Typeface.NORMAL)
            setPadding(0, dp(10), 0, dp(12))
        }
        val content = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        if (photoFile != null) {
            val photo = android.widget.ImageView(this).apply {
                adjustViewBounds = true
                scaleType = android.widget.ImageView.ScaleType.FIT_CENTER
                contentDescription = "Capture preview; use Verify to check integrity"
            }
            content.addView(photo, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(200)))
            submitIo {
                val bitmap = EvidencePhotoPreview.load(photoFile)
                runOnUiThread {
                    if (!isDestroyed && photo.isAttachedToWindow) {
                        photo.setImageBitmap(bitmap)
                        if (bitmap == null) photo.contentDescription = "Capture preview unavailable; original evidence is unchanged"
                    } else bitmap?.recycle()
                }
            }
        }
        content.addView(body)
        val scroll = ScrollView(this).apply { addView(content) }
        panel.addView(scroll, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        panel.addView(compactButton("CLOSE") { root.removeView(shade) }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
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
        verifyEvidence(bundle)
    }

    private fun verifyEvidence(bundle: java.io.File) {
        if (CaptureProgress.isPending(bundle.name)) {
            showTextPanel("EVIDENCE SAVING", "This capture is still collecting its post-event window and video. Wait for Sealed in Events, then verify it.")
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
        exportEvidence(bundle)
    }

    private fun exportEvidence(bundle: java.io.File) {
        if (CaptureProgress.isPending(bundle.name)) {
            showTextPanel("EVIDENCE SAVING", "Wait for this capture to seal before sharing. No incomplete export has been created.")
            return
        }
        bufferText.text = "VERIFYING & PACKAGING EVIDENCE…"
        Toast.makeText(this, "Checking evidence before sharing…", Toast.LENGTH_SHORT).show()
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
                runOnUiThread {
                    bufferText.text = "EXPORT FAILED: ${t.message ?: "unknown"}"
                    showTextPanel("EXPORT FAILED", "No evidence was shared.\n\n${t.message ?: "Unknown error"}")
                }
            }
        }
    }

    private fun showHistory() {
        val root = findViewById<ViewGroup>(android.R.id.content)
        lateinit var history: EvidenceHistoryView
        history = EvidenceHistoryView(this, eventRepository, ::reviewEvent, ::verifyEvidence, ::exportEvidence) {
            root.removeView(history)
        }
        root.addView(history, matchParent())
    }

    private fun reviewEvent(event: ScanEvent) {
        submitIo {
            val bundle = eventRepository.bundleFor(event)
            val photo = bundle?.listFiles()?.firstOrNull { it.extension.equals("jpg", true) }
            val captureInfo = bundle?.let { java.io.File(it, "capture_status.json") }?.takeIf { it.isFile }
                ?.let { runCatching { org.json.JSONObject(it.readText()).toString(2) }.getOrNull() }
            val time = java.text.SimpleDateFormat("dd MMM yyyy • HH:mm:ss", java.util.Locale.UK)
                .format(java.util.Date(event.timestampEpochMs))
            val body = buildString {
                append(time).append("\n\n")
                append("Fusion score: ${event.confidence}% (not a probability)\n")
                append("Profile: ${event.profile ?: "Unknown"}\n")
                append("Track: ${event.trackLabel ?: "None"}\n")
                append("Scene quality: ${event.sceneQualityPercent?.let { "$it%" } ?: "Unknown"}\n")
                event.estimatedDistanceMetres?.let { append("Recorded range estimate: ~%.1f m; not measured depth\n".format(it)) }
                append("\n${event.anomalyReason ?: "No sustained detector disagreement recorded"}\n")
                append("\n${event.explanationSummary ?: event.note}\n")
                append("\nMagnetic: ${event.magneticMicroTesla ?: "Unavailable"} µT\n")
                append("Light: ${event.lightLux ?: "Unavailable"} lx\n")
                append("Audio: ${event.audioDbfs?.let { "$it dBFS" } ?: "Off / unavailable"}\n")
                append("\nSession: ${event.sessionId ?: "Unknown"}\n")
                append("\nBundle: ${event.bundleName ?: "Unavailable"}\n")
                captureInfo?.let { append("\nCapture completion\n$it\n") }
                append("\nA preview does not verify integrity. Use Verify on this event to check its files and signature.")
            }
            runOnUiThread { if (!isDestroyed) showTextPanel("EVENT REVIEW", body, photo) }
        }
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

    private fun hasCameraPermission() = ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED

    private fun hasWifiSurveyPermission() =
        ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

    private fun hasLocalNetworkPermission() =
        Build.VERSION.SDK_INT < 37 ||
            ContextCompat.checkSelfPermission(this, localNetworkPermissionName) == PackageManager.PERMISSION_GRANTED

    private fun refreshCaptureStatus() {
        if (!::captureButton.isInitialized) return
        val allowed = hasCameraPermission()
        val caption = when { !allowed -> "CAMERA ACCESS"; cameraProblem != null -> "RETRY"; else -> "CAPTURE" }
        if (captureButton.text.toString() != caption) captureButton.text = caption
        captureButton.isEnabled = !allowed || cameraProblem != null || cameraReady
        val message = when {
            CaptureProgress.hasPending() -> CaptureProgress.summary()
            !allowed -> "Camera access needed • saved events remain available"
            cameraProblem != null -> "Camera unavailable • tap Retry"
            !cameraReady -> "Starting camera…"
            else -> CaptureProgress.summary()
        }
        if (captureStatusText.text.toString() != message) captureStatusText.text = message
    }

    private fun showCameraPermissionState() {
        cameraReady = false
        statusText.text = "CAMERA PERMISSION REQUIRED"
        detailText.text = "Tap CAMERA ACCESS to retry or open app settings. Saved events and Tools remain available."
        refreshCaptureStatus()
    }

    private fun showCameraFailure(error: Exception) {
        cameraReady = false
        cameraProblem = error.message ?: "Camera could not start"
        statusText.text = "CAMERA UNAVAILABLE"
        detailText.text = "Close other camera apps, then tap Retry."
        bufferText.text = cameraProblem
        refreshCaptureStatus()
    }

    private fun showCameraAccess() {
        androidx.appcompat.app.AlertDialog.Builder(this)
            .setTitle("Camera access")
            .setMessage("Allow camera access for live scanning and captures. You can still review saved events without it. If Android no longer asks, open Settings → Permissions → Camera.")
            .setPositiveButton("Try again") { _, _ -> requestNeededPermissions() }
            .setNeutralButton("Open settings") { _, _ ->
                startActivity(android.content.Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    android.net.Uri.fromParts("package", packageName, null)))
            }
            .setNegativeButton("Not now", null)
            .show()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        outState.putBoolean("labMode", labMode)
        outState.putBoolean("audioMonitoringEnabled", audioMonitoringEnabled)
        super.onSaveInstanceState(outState)
    }

    override fun onResume() {
        super.onResume()
        if (::captureButton.isInitialized) {
            if (hasCameraPermission()) startCamera() else showCameraPermissionState()
            refreshCaptureStatus()
        }
        if (::sensorFusion.isInitialized) sensorFusion.start()
        if (::audioMonitor.isInitialized && audioMonitoringEnabled) audioMonitor.start()
        startOptionalWifiFeatures()
        rollingBuffer?.start()
    }

    override fun onPause() {
        captureInterruptionGeneration++
        consensusGate.reset()
        anomalyEpisodeLatched = false
        rollingBuffer?.stop()
        if (::audioMonitor.isInitialized) audioMonitor.stop()
        if (::sensorFusion.isInitialized) sensorFusion.stop()
        if (::phoneWifiSurvey.isInitialized) phoneWifiSurvey.stop()
        if (::wifiRfBridge.isInitialized) wifiRfBridge.stop()
        super.onPause()
    }

    override fun onDestroy() {
        analysisClosed = true
        mainHandler.removeCallbacksAndMessages(null)
        rollingBuffer?.stop()
        if (::sessionRecorder.isInitialized) submitIo { sessionRecorder.stop() }
        externalHub.stop()
        if (::phoneWifiSurvey.isInitialized) phoneWifiSurvey.stop()
        if (::wifiRfBridge.isInitialized) wifiRfBridge.stop()
        if (::cameraController.isInitialized) cameraController.clearImageAnalysisAnalyzer()
        if (::poseDetector.isInitialized) poseDetector.close()
        if (::faceDetector.isInitialized) faceDetector.close()
        if (::objectDetector.isInitialized) objectDetector.close()
        super.onDestroy()
    }
}
