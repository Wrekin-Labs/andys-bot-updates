# SenseVeil AI v1.0.0-rc6 — Human RF research candidate

Date: 4 October 2026
Branch: `senseveil-rc6-human-rf`
Package: `uk.co.wrekinlabs.senseveil`
Version: `1.0.0-rc6` (code 15)

RC6 is based directly on the verified RC5 hardening branch and preserves the RC5 camera, sensor fusion, evidence signing/encryption, chain-of-custody verification, external radar/thermal protocol, AR support, session replay, Wi-Fi survey and CSI/RF bridge features.

## RC6 additions

- Experimental Human RF research mode with a dedicated opt-in toggle.
- Human-compatible motion classification only when CSI/channel quality gates are met.
- Motion-like variation state for sub-threshold RF patterns.
- RSSI-only, low-rate, high-loss, stale and moving-phone inputs cannot become human-compatible classifications.
- Synthetic bridge results are always labelled `SYNTHETIC_TEST`.
- Human RF pattern confidence is explicitly separate from person/camera confidence.
- Human RF does not feed `FusionScorer`.
- Evidence schema 5 adds optional Human RF state, pattern-confidence and algorithm fields.
- RF status screen and live sensor strip expose the research result and warnings.

## Validation completed on Andy Home

- Full Gradle gate: `clean test lint assembleDebug assembleDebugAndroidTest` — **PASS**.
- JVM unit tests: **91 passed**, zero failures/errors/skips.
- Human RF unit tests: **7 passed**, including RSSI-only, low-rate/high-loss, synthetic and motion-history guards.
- Python verifier/mock-bridge tests: **14 passed**.
- Android API 35 instrumentation regression suite: **9 passed**, zero failures/skips.
- Debug APK metadata: **1.0.0-rc6 / versionCode 15**, minSdk 24, target/compile SDK 37.
- APK Signature Scheme v2: **valid**.
- 16 KB ZIP alignment: **PASS**.
- Debug APK SHA-256: `bc96cbe02e12d84e7a7b55bc9f273138a9ddb4dead7c073ee7928bf670fb85ca`.
- Debug APK size: **176,447,520 bytes**.
- Home debug certificate SHA-256: `79335883b7f78beadafc814db7ebc967fbc7e1b5882c2442b8360464514e63bb`.
- The certificate is the same Home debug signer used by RC5, so this APK can update the Home-signed RC5 installation in place.

## Remaining physical field gates

- Real ESP32/PC CSI field trials with labelled empty-room vs human-motion sessions.
- False-positive trials for doors, fans, pets, moving furniture and changing multipath.
- Physical Android 17/API 37 local-network permission test when suitable real hardware or a stable API-37 environment is available.
- Real-phone battery/thermal and OEM Wi-Fi/CSI bridge endurance testing.

Do not describe RC6 Human RF output as verified person detection until labelled real-world trials establish usable sensitivity/specificity.
