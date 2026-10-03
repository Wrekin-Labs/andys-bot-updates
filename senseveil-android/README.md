# SenseVeil AI — v1.0 release candidate

**See the signal. Verify the source.**

SenseVeil is an Android multisensor presence and detector-disagreement scanner. Vision inference runs on the phone. A sustained anomaly means the detectors disagree; it does not establish a paranormal cause or allow a phone camera to see through walls.

## Included features

- CameraX camera preview, pose/face/object analysis, Field/Lab overlays, track stability and distance estimates.
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
```

Windows: use `gradlew.bat`. Set `ANDROID_HOME` to the installed Android SDK directory or create an untracked `local.properties` containing `sdk.dir=...`.

The debug APK is `app/build/outputs/apk/debug/app-debug.apk`. Install with `adb install -r` or open the supplied APK on Android and approve installation for the source you trust. Android 7/API 24 or later is required. The debug APK contains native libraries for multiple ABIs and is intentionally larger than a store-delivered split APK.

## Field workflow

1. Allow camera permission, open **Tools → Quick Start**, and review **Device Support**.
2. Choose Sensitive/Balanced/Strict, hold the phone still to calibrate, and select Field/Lab mode.
3. Use Capture or allow sustained anomalies to trigger capture. Wait for **EVENT SEALED** before verifying/exporting. Capture completion survives rotation and records any lifecycle interruption or unavailable/partial video in the signed bundle.
4. Use Events, Evidence Review, Verify Last Evidence and Session Replay to inspect measurements.
5. Record the Device Signer ID independently. A valid signature proves consistency with a key; it does not prove the signer's identity or an external timestamp.
6. Export a verification ZIP for sharing. When the vault option is enabled, an encrypted device-bound SVE copy is also retained; the sharing ZIP is cleartext.

Microphone level monitoring is opt-in; it does not save raw audio. Evidence stays in app storage unless you explicitly export it. Cloud backup/device transfer are excluded. Uninstalling or clearing app data destroys Android Keystore keys and can make SVE vaults unrecoverable. Export required evidence first.

## Verification and limitations

`RELEASE_STATUS.md` records the verified build, tests and remaining physical-device checks. A debug build is a tester deliverable, not a Play production-signed release. Real camera quality, thermal/battery behaviour, radar/thermal devices and AR depth require compatible physical hardware.

The root repository workflow `.github/workflows/senseveil-android.yml` builds and tests this subproject, uploads the debug APK and runs Android device tests. No credentials, device evidence, signing keys or local SDK paths belong in Git.
