# SenseVeil AI v1.0.0-rc4 — verification record

Updated 3 October 2026 (UK). Application source: `fdd2374496d556618917d8eacd8a3ccc59677f37` on branch `senseveil-v1.0-rc4-wifi`.

Package: `uk.co.wrekinlabs.senseveil`
Version: `1.0.0-rc4` (code 13)
Minimum Android: API 24 / Android 7

## RC4 changes

- Adds an **opt-in phone Wi-Fi survey** that records aggregate radio statistics only: visible AP count, strongest/median RSSI and 2.4/5/6 GHz counts. SSIDs and BSSIDs are not written to evidence.
- Adds an **opt-in local CSI/RF bridge** for ESP32/PC or other external RF hardware. The endpoint and pair code are operator-controlled.
- Adds Android 17/API 37 Local Network permission handling for direct LAN bridge traffic, while Wi-Fi scan permissions are requested only when the Wi-Fi survey is enabled.
- Adds a versioned newline-delimited JSON RF protocol with pair-code, source, sequence, timestamp, sample-rate and finite-value validation.
- Rejects unsafe RF source labels before they can enter signed CSV/evidence records.
- Requires at least 4 RF samples/s and a 30-sample stationary baseline. Sustained RF change requires at least five positive frames across at least 800 ms.
- Invalidates the RF baseline when the phone moves, recalibrates after every bridge reconnect, rejects stale/out-of-order input and prevents old socket workers from surviving a rapid stop/start cycle.
- Handles devices without a Wi-Fi service without crashing.
- Keeps Wi-Fi/RF **outside** `FusionScorer`, pose/face confidence and automatic person classification. It is an environmental evidence channel, not a through-wall person detector.
- Adds RF/Wi-Fi fields to signed session/event evidence and writes `rf_pre.csv` / `rf_window.csv`.
- Adds Tools controls for Wi-Fi survey, RF bridge enable/setup/status and baseline reset.
- Adds a synthetic mock RF bridge for transport/UI testing. Synthetic data is labelled as test data and is not evidence of presence.

All RC1–RC3 camera, multisensor fusion, anomaly consensus, evidence signing/encryption, chain-of-custody verification, session replay, external SV1 sensor protocol, AR capability probe, retention, event review and diagnostics features are preserved.

## Local validation on Andy Home

- `gradlew.bat test lint assembleDebug assembleDebugAndroidTest`: **PASS** on the final application source.
- JVM tests: **33 passed**, zero failures/errors/skips, including six RC4 Wi-Fi/RF regression tests.
- Independent Python evidence verifier: **5 passed** locally after making the test harness portable to Git-for-Windows OpenSSL and Windows ZIP path semantics.
- Android lint: **0 errors**, 135 warnings. No lint errors are baselined or disabled.
- Debug APK: Android v2 signature **valid**.
- 16 KB ZIP alignment: **PASS**.
- `git diff --check`: clean for the application source.

## GitHub CI

Final application-source run: https://github.com/Wrekin-Labs/andys-bot-updates/actions/runs/37148246490

- Build job: **PASS** (Gradle build, JVM tests, lint, debug APK, instrumentation APK, five independent Python evidence-verifier tests).
- Device-test job: **PASS** on API 35.
- Android instrumentation: **9 tests passed**, zero failed/skipped.
- Permission smoke: **PASS**, 2 checks.

Across the final application-source validation this gives 33 JVM tests + 5 independent evidence-verifier tests + 9 Android device tests + 2 permission-smoke checks = **49 passing automated checks**. The device suite uses a disposable API 35 Google APIs emulator, so it does not certify the Android 17/API 37 Local Network runtime dialog.

## Home installer provenance

File: `SenseVeil-AI-v1.0.0-rc4-debug.apk`
Location: `Desktop\SenseVeil-AI-v1.0-RC4`
Size: **176,643,420 bytes**
SHA-256: `f1063223717a78a7a60d378a3bce90a5f368cfd6e215db8c4beb25b952bb5c02`
Debug certificate SHA-256: `79335883b7f78beadafc814db7ebc967fbc7e1b5882c2442b8360464514e63bb`

The Home RC4 certificate matches the actual Home RC3 installer certificate, so RC4 can update that RC3 installation in place. CI uses its own debug signing key, so a CI APK can have a different checksum/certificate.

Do **not** uninstall SenseVeil or clear app data if existing device-bound SVE vaults or signing keys are needed. Export required evidence first.

## Remaining field gates

RC4 is a debug field-test release candidate, not a production Play-signed release. The following still require appropriate real hardware or a matching platform image:

- real ESP32/PC CSI/RF transport and calibration in the intended room;
- controlled RF baseline/false-positive testing with people, doors, furniture and multipath changes;
- Android 17/API 37 Local Network permission prompt and denial/recovery path;
- real-phone Wi-Fi survey with Location services on/off and OEM scan throttling;
- camera/pose/range behaviour in low light and movement;
- long-session battery/thermal behaviour and low-storage fault injection;
- TalkBack/enlarged-text landscape checks and third-party share-target checks.

RF change means **environmental radio variation only**. It does not identify what caused the change, produce a body image through a wall, or establish a paranormal cause.
