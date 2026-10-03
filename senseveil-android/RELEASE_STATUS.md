# SenseVeil AI v1.0.0-rc3 — verification record

Updated 3 October 2026 (UTC). Application source: `89db2422a31b14d32e833c6776cb308950f5d4b2`; validation revision: `236ece19af7447b242946500aa6cade4a116a007` (test harness changes only).

## RC3 changes

- Protect in-flight evidence and matching archives from retention cleanup; serialize housekeeping with evidence I/O off the UI thread.
- Preserve live sessions during Activity recreation and freeze capture sensor/profile metadata at the trigger.
- Reject new background capture requests while allowing existing captures to finish sealing.
- Recover camera access through retry/Settings and refresh camera state on returning to the app.
- Let controls grow with large text; make Device Support scrollable with a reachable Close control.
- Respect all JPEG EXIF rotations/reflections in photo previews without modifying signed originals.
- Preserve fusion, consensus, custody checks, signing/encryption, external protocol, AR capability, replay and diagnostics.

See [RC3_DESIGN_AUDIT.md](RC3_DESIGN_AUDIT.md) for the current screenshot audit and detailed evidence limits.

## RC3 verification

- Local Gradle `test lint assembleDebug assembleDebugAndroidTest`: PASS on the exact source above.
- 27 JVM tests and five independent Python verifier tests: PASS, no failures/errors/skips.
- Lint: zero errors, 110 warnings; no errors baselined and no checks disabled.
- APK: Android v2 signature valid; final 16 KB ZIP alignment PASS.
- Final GitHub [run 37132323436](https://github.com/Wrekin-Labs/andys-bot-updates/actions/runs/37132323436): **build and device-tests PASS**. All nine native Android tests passed (175.778 s), plus both standalone permission checks. Together with JVM and Python coverage, **43 checks passed**, with no failures/errors/skips.
- Andy Home built the same final app and test APKs successfully (3 min 10 s).

The first RC3 device run failed four UI tests behind a confirmed Pixel Launcher ANR. It is not counted as a pass. The revised harness clears only that specific emulator launcher interruption and compiles APKs before booting the emulator to reduce contention. It does not dismiss SenseVeil crashes or ANRs.

An intermediate run passed all native Android tests but exposed a permission-test setup error after Gradle uninstalled the app. The standalone smoke script now reinstalls the exact built APK before checking denial and Settings-return recovery. The final successful run includes this fix. Eleven accepted screenshots from that run are preserved in `docs/qa/rc3/` and the linked five-step audit.

## RC3 installer provenance

- Package `uk.co.wrekinlabs.senseveil`; version `1.0.0-rc3`, code 12; minimum Android 7/API 24.
- File: `SenseVeil-AI-v1.0.0-rc3-debug.apk`; 176,582,786 bytes.
- SHA-256: `89e3e8dfdd271fd3f88d87a0246cc45ce7f058a8aff9d007a6994f65c8f8ed56`.
- Debug certificate SHA-256: `9657cb624dab8cb0649a5ac39fd2f98f07a054d56ae3b38fe94d748cd014a5f1` (same as the downloadable RC1/RC2 installers).
- CI and Andy Home use their respective debug keys; use the same installer source to update an existing debug installation. Export needed evidence before uninstalling or clearing app data, which destroys device-bound vault keys.

The independently built Home installer is at `Desktop\SenseVeil-AI-v1.0-RC3`, with `SHA256SUMS.txt`. Its SHA-256 is `efe7d084e5762844c7d0b2bda4208393cb89ec78ffcbec54a79fe68b3fa2b55a`; it is 176,582,498 bytes and passes Android v2 signing and 16 KB ZIP alignment. Its certificate matches the earlier Home installers.

## RC3 field-test gates

This is a debug release candidate for testing. Physical camera/pose/range accuracy, low-light movement, TalkBack and enlarged-font landscape scanning, microphone opt-in, long-session battery/thermal behaviour, low-storage fault injection and real-device export/import remain checks for the phone.

The preserved external sensor layer is the SV1 protocol/parser/replay guard and adapter interface. Vendor-specific BLE/USB transports are not implemented. AR depth remains a capability probe, not live depth capture. Wi-Fi through-wall sensing is not implemented.

---

# Historical RC2 verification record

Updated 3 October 2026 (UTC). Application source: `fa14d06343976cf6226481bd5f7da9e7afa6b783`.

## RC2 changes

- Clearer Field overlay and header spacing; detailed detections remain in Lab.
- Per-event review, verification and sharing, with unsealed exports blocked.
- Capture progress survives rotation and rapid repeated manual taps are debounced.
- Corrected ML Kit pose coordinates using the matching frame's camera-to-view transform, including rotation and crop.
- Rough shoulder-based range is gated by frontal pose/face quality and remains available in Lab and evidence; Field does not present it as a measured distance.
- Grouped Tools and larger evidence text. Existing fusion, consensus, signing, encryption, custody checks, external protocol, AR capability probe, replay and diagnostics remain.

See [RC2_FIELD_AUDIT.md](RC2_FIELD_AUDIT.md) for the five-step audit and screenshots.

## RC2 verification

- Local Gradle `test lint assembleDebug assembleDebugAndroidTest`: PASS.
- 23 JVM tests and five independent Python verifier tests: PASS, no failures.
- Lint: zero errors, 112 warnings. No checks disabled or errors baselined.
- Debug APK signature: Android v2 valid; final 16 KB ZIP alignment: PASS.
- Final CI: [run 37114880198](https://github.com/Wrekin-Labs/andys-bot-updates/actions/runs/37114880198). Both build and device-tests jobs passed for the exact source above. All five Android tests passed on API 35 with zero failures, errors or skips (79.489 s), for **33 tests total**.

The Android suite checks Tools/Back/diagnostics, real emulator capture sealing across rotation, Keystore/AES-GCM tamper rejection, selected older-event verification/export while the newest remains unsealed, and pose projection across all right-angle rotations/crop/scale. Final CI screenshots were visually inspected and are retained in `docs/qa/rc2/`.

The initial Andy Home RC2 device run was blocked by an emulator System UI ANR dialog (confirmed by failure screenshot); its three UI failures are not counted as application passes. The final source independently passed the complete CI device suite. Andy Home also built the final app and test APKs successfully.

## RC2 installer provenance

- Package `uk.co.wrekinlabs.senseveil`; version `1.0.0-rc2`, code 11; minimum Android 7/API 24.
- File: `SenseVeil-AI-v1.0.0-rc2-debug.apk`; 176,579,821 bytes.
- SHA-256: `b95b14c23f0fa792736566e4deabd513bb01d8d3ab9fc0bcedc33f9818f58e48`.
- Debug certificate SHA-256: `9657cb624dab8cb0649a5ac39fd2f98f07a054d56ae3b38fe94d748cd014a5f1` (same as the downloadable RC1 installer).
- CI and Andy Home build APKs use their respective debug keys and have different checksums. Update an existing debug installation using the same build source/key. Preserve needed evidence before uninstalling or clearing app data.

The independently built Home installer is at `Desktop\SenseVeil-AI-v1.0-RC2`, with `SHA256SUMS.txt`. Its SHA-256 is `51eee088544ea9abe7d8c36bc75da2489ce9af6cd06646ca558ceb4c5e147a12`; it is 176,579,821 bytes and passes 16 KB ZIP alignment.

## Remaining physical-device checks

The owner confirmed that RC1 installed and ran on their phone. RC2 still needs real-phone overlay/range checks, TalkBack and enlarged-font checks, low-light/movement, audio opt-in/permission denial, haptics, long sessions, low storage and export/import exercises.

The external sensor implementation remains the supplied SV1 protocol/parser/replay guard and adapter interface; vendor BLE/USB transports are not implemented. AR depth remains a capability probe, not live depth capture. Wi-Fi sensing is not part of this APK. Emulator tests do not establish physical measurement accuracy.

---

# Historical RC1 verification record

Updated 3 October 2026 (UTC).

**Ready for v1.0 RC field testing.** Application source `a976c34` passed both GitHub CI jobs and all 27 automated tests. Physical sensor and camera-quality checks remain production-release gates.

## Verified

- Source: latest `senseveil-v10rc1-build.zip`, compared against all v0.9 Kotlin feature files. No existing feature classes removed.
- Full clean Gradle 9.3.1 / AGP 9.1.1 / JDK 17 / Android 37.0 build: PASS.
- `clean test lint assembleDebug assembleDebugAndroidTest`: PASS (81 executed tasks).
- JVM suite: 19 tests, zero failures.
- Independent Python evidence-verifier suite: 5 tests, zero failures; includes real ECDSA signatures via OpenSSL.
- Android lint: zero errors; 110 warnings remain, predominantly English text/localisation, dependency update notices and drawing allocations. No lint checks disabled and no errors baselined.
- Debug APK Android v2 signature verified with `apksigner`.
- Debug APK and instrumentation APK produced. ARM64 native libraries checked for 16 KB ELF load-segment alignment: PASS. Final APK `zipalign -c -P 16 4`: PASS.

## Fixes in this candidate

- Fixed Kotlin sensor-set inference and evidence import filename interpolation errors.
- Added a checked-in, checksum-pinned Gradle wrapper and root monorepo CI workflow.
- Restored the v0.9 documentation and independent evidence verification tool omitted from the RC build archive.
- Reject non-finite/malformed/duplicate external sensor fields, metadata downgrades and invalid replay/timestamp values.
- Reset consensus across interrupted frame streams, identity changes and profile changes.
- Reject empty/duplicate/unsafe manifests, unsigned extra files and tampered payloads. Export verifies existing signatures and never automatically authenticates changed evidence.
- Normalize numeric representations for new session hash chains, retain legacy verification attempts, check closing count/tail, sign closed sessions, and expose a session picker.
- Reject duplicate/unsafe ZIP paths, clean failed import files, and publish decrypted plaintext only after GCM authentication succeeds.
- Correct the AppCompat theme mismatch caught by emulator launch testing.
- Wait for CameraX initialization before recording; finish capture work across rotation, seal once after all producers finish, and sign interruption/video status. Late video cannot alter sealed bundles.
- Scroll the full Tools list, handle Back for overlays, apply system-bar insets, enlarge controls and improve microphone/camera lifecycle handling.
- Probe optional AR depth capabilities when permission/ARCore permit it. Add backup/data-transfer exclusions for evidence and keys.
- Preserve simultaneous rolling-buffer capture targets and prevent overlapping recording rotation on pause/resume.
- Keep ML Kit task completions safe after Activity teardown.
- Place radar alongside status in landscape; retain 48 dp controls and scrollable Tools.
- Stream large session/event histories and run evidence/session verification away from the UI thread. Keep latest-event selection tied to capture order, not delayed sealing time.

## Runtime and hardware gates

All three Android instrumentation tests passed on Andy Home and GitHub CI for the final application source `a976c34`, on accelerated API 35 emulators. Zero failures, errors or skipped tests. The two CI jobs (build and device-tests) are green. Audit screenshots are retained in the device-test artifact; portrait and landscape screenshots were visually inspected on Andy Home.

The tests cover:
- Tools scrolling, Quick Start and Back navigation, portrait/landscape launch, diagnostics creation.
- Real emulator camera capture, Activity rotation while the post-event window is pending, then verification of the complete signed evidence bundle.
- Android Keystore ECDSA signing, payload tampering, AES-GCM round trip, and rejection of an altered authentication tag without publishing plaintext.

The initial device runs exposed and led to fixes for an AppCompat theme mismatch and an ML Kit callback/worker-shutdown race. An earlier software-only API 30 emulator attempt could not satisfy ADB property timeouts and is not counted as a successful device test.

Before production release, test on physical Android hardware: live CameraX/ML Kit accuracy, low light/movement, permission denial/retry, haptics, audio opt-in, rapid capture/pause/rotation, post-event video completeness, low storage/retention, signed evidence export/import and SVE recovery limitations, ARCore on supported/unsupported devices, and real external adapters.

The shipped external sensor layer remains an SV1 protocol/parser/replay guard plus adapter interface and discovery report. A vendor-specific BLE/USB transport is not implemented. AR depth is a capability probe, not a live depth-capture mode. These limitations were present in v0.9/RC1 and are disclosed rather than represented as completed hardware functionality.

## Reproduce

```sh
./gradlew clean test lint assembleDebug assembleDebugAndroidTest
python3 -m unittest discover -s tools -p 'test_*.py' -v
./gradlew connectedDebugAndroidTest
```

No production signing key or Play release is included. Debug signing certificates differ between machines/CI; updating an existing debug install requires the same signing key. Do not uninstall an installation holding needed SVE vaults: export first, because uninstalling destroys device-bound keys.


## Installer provenance

- Package: `uk.co.wrekinlabs.senseveil`
- Version: `1.0.0-rc1` (code 10), minimum Android 7 / API 24.
- Installer size: 176,365,464 bytes (about 168 MiB).
- Distributed file: `SenseVeil-AI-v1.0.0-rc1-debug.apk` (universal debug APK).
- SHA-256: `0a1731532ab58371df0a7e98d6d760d556ba282367953dbc75f2fd0fe9c3e22d`.
- Application source commit: `a976c349ad840a5eefd484c91ff48d49048160d5`.
- Final CI run: https://github.com/Wrekin-Labs/andys-bot-updates/actions/runs/37111281645

CI/Andy Home APK signatures and checksums differ from the supplied installer because each build machine uses its own debug signing certificate. The CI run publishes its own APK and checksum together.


The independently built Andy Home installer is also at `Desktop\SenseVeil-AI-v1.0-RC1`, with a checksum file. Its SHA-256 is `cbf6d484bc680854c712b82004547be817c99c0551590da74aae147e752b035e`.
