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

## Validation still required

- JVM unit suite including `HumanRfInterpreterTest`.
- Full lint/build/debug APK.
- Existing Android instrumentation regression suite.
- Real ESP32/PC CSI field trials with labelled empty-room vs human-motion sessions.
- False-positive trials for doors, fans, pets, moving furniture and changing multipath.
- Physical Android 17 local-network permission test when suitable hardware/API image is available.

Do not describe RC6 Human RF output as verified person detection until labelled real-world trials establish usable sensitivity/specificity.
