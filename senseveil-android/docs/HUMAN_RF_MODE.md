# SenseVeil RC6 — Human RF research mode

Human RF research mode is an **experimental interpretation layer** over the hardened RC5 CSI/RF channel.

It does not replace camera detection and it does not feed `FusionScorer`, face detection, pose detection, object detection or the normal person-confidence score.

## What it can report

- `QUIET` — no sustained human-compatible RF motion pattern.
- `MOTION_LIKE_VARIATION` — multi-channel RF variation looks motion-like but has not crossed the sustained-change gate.
- `HUMAN_COMPATIBLE_MOTION` — sustained multi-channel CSI/RF change is compatible with human movement.
- `ENVIRONMENT_CHANGE` — strong RF change exists, but the data is not suitable for a Human RF interpretation.
- `SYNTHETIC_TEST` — the mock bridge produced the result; never treat it as real presence evidence.
- calibration/unavailable/off states are explicit.

The percentage shown is **pattern confidence**, not probability that a person is present.

## Minimum signal gate

Human-compatible classification requires:
- at least two RF channels;
- at least one CSI channel (amplitude or variance);
- effective sample rate of at least 4 Hz;
- packet loss no higher than 30%;
- a stationary phone and a valid RC5 RF baseline.

RSSI-only bridges can still report environmental RF change but cannot produce a Human RF classification.

## Important limitations

Doors, fans, pets, moving furniture, moving access points, people outside the target area and multipath changes can create similar RF patterns. Human RF mode therefore reports *human-compatible motion*, not a verified person, body image, identity, exact location or paranormal cause.

Through-wall use requires suitable external CSI hardware and controlled calibration. A normal Android Wi-Fi scan by itself is not sufficient for reliable through-wall human sensing.

## Evidence schema 5

When the mode is enabled, signed event/session evidence may include:
- `humanRfState`
- `humanRfPatternConfidence`
- `humanRfAlgorithm`

Algorithm ID: `human-rf-pattern-v1`.

Schema 1–4 evidence remains readable; the new fields are additive and optional.
