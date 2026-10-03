# SenseVeil AI v1.0.0-rc4 release status

Date: 3 October 2026
Branch: `senseveil-v1.0-rc4-wifi`
Android package: `uk.co.wrekinlabs.senseveil`
Version code: 13

## Implemented in RC4

- Opt-in phone Wi-Fi survey with aggregate-only evidence: visible AP count, strongest/median RSSI and 2.4/5/6 GHz counts. SSID/BSSID are not stored.
- Android 17/API 37 Local Network runtime permission for the optional direct TCP RF bridge.
- Coarse + precise location are requested together only when the Wi-Fi survey is enabled, as required by Android Wi-Fi scan APIs.
- Configurable RF bridge host/port and generated local pair code.
- Newline-delimited JSON RF/CSI bridge protocol with version, pairing, sequence, sample-rate and finite-value validation.
- Stationary 30-sample baseline, low-rate rejection, phone-motion pause, stale-data state and sustained RF-change gate.
- RF/CSI is intentionally isolated from `FusionScorer`, camera person confidence and automatic human classification.
- RF snapshots are added to signed session rows and capture metadata. Evidence bundles include `rf_pre.csv` and `rf_window.csv`.
- Tools UI includes Wi-Fi survey toggle, RF bridge toggle/setup/status and baseline reset.
- Device Support reports Wi-Fi hardware, Wi-Fi survey permission and Local Network permission.
- Protocol/setup documentation and a synthetic mock RF bridge are included for transport/UI validation.

## Automated validation

- Android/JVM unit tests: 32 passed, 0 failed, including 5 RC4 RF regression tests.
- `lintDebug`: 0 errors. Existing translation/deprecation/style warnings remain non-blocking.
- `git diff --check`: clean.
- Debug APK builds successfully.
- No ADB device was connected during the local RC4 pass, so physical-device Android instrumentation remains a CI/field gate.

## Remaining physical validation

These cannot be honestly certified by a desktop-only build:

- camera/pose behaviour on the target phone;
- Android 17 permission prompts on a physical target;
- battery/thermal behaviour in a long session;
- RF baseline stability and thresholds using the actual ESP32/PC CSI hardware and room geometry;
- accessibility/TalkBack checks on the target phone.

RF change is environmental evidence only. It does not identify a person or produce through-wall imagery.
