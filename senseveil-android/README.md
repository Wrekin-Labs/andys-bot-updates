# SenseVeil AI — v1.0.0-rc3

**See the signal. Verify the source.**

SenseVeil is an Android multisensor presence and detector-disagreement scanner. Vision inference runs on the phone. A sustained anomaly means the detectors disagree; it does not establish a paranormal cause or allow a phone camera to see through walls.

## Included features

- CameraX camera preview, pose/face/object analysis with timestamp-matched viewport projection, Field/Lab overlays, track stability and gated rough monocular range in Lab.
- Environmental sensor baselines, optional microphone level metering, weighted multisensor fusion, and multi-frame anomaly consensus.
- Manual/automatic event capture, rolling video, pre/post sensor and decision timelines, explanation reports and event history.
- SHA-256 manifests, device-held ECDSA signatures, AES-GCM encrypted vaults, ZIP/SVE import verification and operator-pinned signer fingerprints.
- Session replay with session selection, versioned numeric canonicalization, closing count/tail checkpoints and signed closed sessions.
- External RADAR/THERMAL/DEPTH/RANGING SV1 protocol, discovery reports, freshness/sequence guards, optional ARCore depth capability probe.
- Retention controls, interrupted-session recovery, first-run guidance, local crash diagnostics and diagnostics export.

The external sensor layer is a protocol and integration interface. The default hub is disconnected; vendor-specific live BLE/USB adapters and live AR depth capture are not implemented. Depth capability probing is available on a compatible phone with ARCore installed. No sensor readings are fabricated to represent absent hardware.

## Build

Use JDK 17, Android SDK platform **37.0**, build-tools 36.0.0, and the checked-in Gradle 9.3.1 wrapper (distribution SHA-256 pinned). AGP is pinned at 9.1.1.

```sh
./gradlew clean test lint assembleDebug assembleDebugAndroidTest
python3 -m unittest discover -s tools -p 'test_*.py' -v
# With a booted, authorized emulator or phone:
./gradlew connectedDebugAndroidTest
# Full CI device flow on a disposable emulator only:
ANDROID_SERIAL=emulator-5554 ./tools/run-device-tests.sh
```

The full CI device script reinstalls the built APK and exercises camera denial and a Settings grant. It refuses to run the permission smoke on a physical-device serial.

Windows: use `gradlew.bat`. Set `ANDROID_HOME` to the installed Android SDK directory or create an untracked `local.properties` containing `sdk.dir=...`.

The debug APK is `app/build/outputs/apk/debug/app-debug.apk`. Install with `adb install -r` or open the supplied APK on Android and approve installation for the source you trust. Android 7/API 24 or later is required. The debug APK contains native libraries for multiple ABIs and is intentionally larger than a store-delivered split APK.

## Field workflow

1. Allow camera permission, open **Tools → Quick Start**, and review **Device Support**.
2. Choose Sensitive/Balanced/Strict, hold the phone still to calibrate, and select Field/Lab mode.
3. Use Capture or allow sustained anomalies to trigger capture. Wait for **Evidence sealed** before verifying/exporting. Capture completion survives rotation and records any lifecycle interruption or unavailable/partial video in the signed bundle.
4. Open **Events** and choose **Review**, **Verify**, or **Share** on the capture you want. Unsealed captures cannot be verified or shared. Use Session Replay for session timelines; the latest-evidence Tools shortcuts remain available.
5. Record the Device Signer ID independently. A valid signature proves consistency with a key; it does not prove the signer's identity or an external timestamp.
6. Export a verification ZIP for sharing. When the vault option is enabled, an encrypted device-bound SVE copy is also retained; the sharing ZIP is cleartext.

Microphone level monitoring is opt-in; it does not save raw audio. Evidence stays in app storage unless you explicitly export it. Cloud backup/device transfer are excluded. Uninstalling or clearing app data destroys Android Keystore keys and can make SVE vaults unrecoverable. Export required evidence first.

## RC3 reliability and accessibility

Pending captures and their archives are protected from age/quota cleanup. Housekeeping runs away from the UI thread; session recovery skips sessions still owned by this process. Capture metadata keeps the sensor snapshot and profile from the trigger time. New capture requests are rejected after the Activity leaves the foreground, while existing captures still finish sealing.

Camera denial leaves Events and Tools available. Camera Access offers retry and app Settings; returning after a grant starts the camera. The capture status distinguishes starting, unavailable, permission-needed and ready states. Buttons grow with larger text, Device Support uses a scrolling report, and Field/Lab plus an opted-in microphone setting survive Activity recreation. Photo previews respect JPEG rotation and mirroring without changing signed originals. See [RC3_DESIGN_AUDIT.md](RC3_DESIGN_AUDIT.md).

## RC2 field-feedback improvements

The scanner has clearer Field overlays and a direction-only vision map; detailed boxes/skeleton remain in Lab. Capture progress survives rotation. Event cards support individual review, verification and export. See [RC2_FIELD_AUDIT.md](RC2_FIELD_AUDIT.md) for the screenshot audit and coordinate/range fix.

## Verification and limitations

`RELEASE_STATUS.md` records the verified build, tests and remaining physical-device checks. A debug build is a tester deliverable, not a Play production-signed release. Real camera quality, thermal/battery behaviour, radar/thermal devices and AR depth require compatible physical hardware.

The root repository workflow `.github/workflows/senseveil-android.yml` builds and tests this subproject, uploads the debug APK and runs Android device tests. No credentials, device evidence, signing keys or local SDK paths belong in Git.


## RC4 Wi-Fi / CSI RF evidence

RC4 adds optional aggregate Wi-Fi surveys and a paired local-network RF/CSI bridge. Open **Tools → Wi-Fi / RF sensing** to enable them. Both are off by default and their permissions are requested only when enabled.

The phone survey records AP counts and aggregate RSSI/band statistics only; it does not store SSIDs/BSSIDs. The CSI bridge uses a generated pair code, stationary baseline, sample-rate/staleness checks, motion suppression and sustained-change gating. RF observations are written into signed session/evidence data but are deliberately excluded from person-detection fusion and automatic human confidence.

See [docs/WIFI_RF_CSI.md](docs/WIFI_RF_CSI.md) for the protocol, Android 17 permission behaviour, limitations and mock-bridge test procedure.
