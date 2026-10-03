# SenseVeil AI v1.0 RC1 — verification record

Updated 3 October 2026 (UTC).

## Verified

- Source: latest `senseveil-v10rc1-build.zip`, compared against all v0.9 Kotlin feature files. No existing feature classes removed.
- Full clean Gradle 9.3.1 / AGP 9.1.1 / JDK 17 / Android 37.0 build: PASS.
- `clean test lint assembleDebug assembleDebugAndroidTest`: PASS (81 executed tasks).
- JVM suite: 19 tests, zero failures.
- Independent Python evidence-verifier suite: 5 tests, zero failures; includes real ECDSA signatures via OpenSSL.
- Android lint: zero errors; 107 warnings remain, predominantly English text/localisation, dependency update notices and drawing allocations. No lint checks disabled and no errors baselined.
- Debug APK and instrumentation APK produced. ARM64 native libraries checked for 16 KB ELF load-segment alignment: PASS.

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

## Runtime and hardware gates

Runtime UI/Keystore/capture instrumentation is in progress. The first CI device run caught an inherited launch crash (AppCompat activity with a platform theme); the theme is now corrected and rerun is required. The local API 30 software emulator booted slowly without hardware acceleration; the first device-test attempt timed out before Android could report its API level. That attempt did not execute app tests and is not counted as a pass. A hardware-accelerated API 35 emulator is being prepared on Andy Home. CI contains the same device tests.

Before production release, test on physical Android hardware: live CameraX/ML Kit accuracy, low light/movement, permission denial/retry, haptics, audio opt-in, rapid capture/pause/rotation, post-event video completeness, low storage/retention, signed evidence export/import and SVE recovery limitations, ARCore on supported/unsupported devices, and real external adapters.

The shipped external sensor layer remains an SV1 protocol/parser/replay guard plus adapter interface and discovery report. A vendor-specific BLE/USB transport is not implemented. AR depth is a capability probe, not a live depth-capture mode. These limitations were present in v0.9/RC1 and are disclosed rather than represented as completed hardware functionality.

## Reproduce

```sh
./gradlew clean test lint assembleDebug assembleDebugAndroidTest
python3 -m unittest discover -s tools -p 'test_*.py' -v
./gradlew connectedDebugAndroidTest
```

No production signing key or Play release is included. Debug signing certificates differ between machines/CI; updating an existing debug install requires the same signing key. Do not uninstall an installation holding needed SVE vaults: export first, because uninstalling destroys device-bound keys.
