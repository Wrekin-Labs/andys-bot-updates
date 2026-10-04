# SenseVeil AI v1.0.0-rc5 — verification record

Updated 4 October 2026 (UK). Branch: `senseveil-rc5-hardening`.

Package: `uk.co.wrekinlabs.senseveil`
Version: `1.0.0-rc5` (code 14)
Minimum Android: API 24 / Android 7
Target / compile SDK: 37 / Android 17

## RC5 hardening

RC5 preserves the RC1–RC4 camera, multisensor fusion, anomaly consensus, evidence signing/encryption, chain-of-custody verification, session replay, external sensor protocol, AR capability probe, retention, event review and diagnostics features.

The RC5 hardening set adds or improves:

- strict RF numeric parsing so huge finite doubles cannot become Float infinity and poison a baseline;
- a bounded RF line reader and guarded socket lifecycle so stop/restart cannot leave stale callbacks alive;
- strict sequence parsing with replay/rollback recovery;
- robust MAD-based RF novelty handling, hysteresis and multi-channel corroboration;
- motion-gated RF baseline handling and controlled re-baselining;
- local-host policy by default for the RF bridge, with explicit advanced override;
- optional authenticated protocol-v2 HMAC support;
- Wi-Fi unavailable/unknown values represented as unknown rather than false zero;
- Wi-Fi result freshness, Location Services and permission checks;
- synthetic RF lab data labelled end to end;
- schema 4 additive RF provenance fields;
- independent verifier trust semantics aligned to Android signer-pinning behaviour;
- filesystem alias/case/Unicode/path hardening in the independent verifier;
- API 37 / ACCESS_LOCAL_NETWORK CI coverage when a matching emulator image is available;
- improved RC5 RF status/setup UI and throttled UI updates.

RF remains an environmental evidence channel only. It is deliberately excluded from `FusionScorer` and person confidence.

## Local validation on Andy Home

- JVM unit tests: **84 passed**, zero failures/errors/skips.
- Python verifier/mock bridge tests: **14 passed**.
- Android instrumentation on Home API 36 emulator: **9 passed**, zero failures/skips.
- The previously flaky enlarged-text Tools/Device Support scroll test was fixed to wait for the Tools UI and target the actual Android `ScrollView`; it passes standalone and in the full 9-test suite.
- `git diff --check`: **PASS**.
- Debug APK metadata: **1.0.0-rc5 / versionCode 14**.
- Android APK Signature Scheme v2: **valid**.
- 16 KB ZIP alignment: **PASS**.
- Home debug certificate SHA-256: `79335883b7f78beadafc814db7ebc967fbc7e1b5882c2442b8360464514e63bb`.
- The certificate matches the RC4 Home installer, so RC5 can update that installation in place.

A final local lint-only rerun was impeded by shared Gradle-cache contention from other Android builds on the same PC. The final pushed branch must therefore use GitHub CI as the independent clean lint/build gate before this record is considered fully closed.

## Home installer provenance

File: `SenseVeil-AI-v1.0.0-rc5-debug.apk`
Planned location: `Desktop\SenseVeil-AI-v1.0-RC5`
Size: **176,709,561 bytes**
SHA-256: `5451a9f211ba0350e3a1e9f810340448409eeb85e529b5fd37b62ce213ad183d`
Debug certificate SHA-256: `79335883b7f78beadafc814db7ebc967fbc7e1b5882c2442b8360464514e63bb`

Do **not** uninstall SenseVeil or clear app data if existing device-bound SVE vaults or signing keys are needed. Install RC5 over the existing Home RC4/RC3 installation.

## Remaining physical field gates

RC5 is still a debug field-test release candidate, not a production Play-signed release. These checks require the relevant real hardware or matching platform environment:

- real ESP32/PC CSI/RF transport and room calibration;
- controlled RF false-positive testing with people, doors, furniture and multipath changes;
- Android 17/API 37 Local Network permission prompt, denial and recovery path;
- real-phone Wi-Fi survey with Location Services on/off and OEM scan throttling;
- extended physical-phone battery/thermal and low-storage testing;
- physical low-light/movement camera testing;
- TalkBack and third-party share-target checks on representative phones.

RF change means **environmental radio variation only**. It does not identify what caused the change, image a person through a wall, or establish a paranormal cause.
