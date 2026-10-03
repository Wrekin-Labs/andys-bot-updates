# SenseVeil AI v1.0 RC1 — verification record

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
