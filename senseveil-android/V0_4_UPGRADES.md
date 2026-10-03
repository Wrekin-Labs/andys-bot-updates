# SenseVeil AI v0.4 upgrade notes

## Detection confidence is no longer a one-frame decision

v0.4 adds a profile-specific temporal consensus gate. A raw detector disagreement is shown as an amber **candidate**. It must persist across enough frames for long enough before it becomes a magenta **sustained anomaly** and can trigger automatic evidence capture.

Default consensus settings:

| Profile | Window | Required positive frames | Minimum persistence |
|---|---:|---:|---:|
| Sensitive | 6 | 4 | 350 ms |
| Balanced | 8 | 6 | 600 ms |
| Strict | 10 | 8 | 900 ms |

## Explainable events

Each event can now include:

- pose/landmark evidence
- target stability
- face cross-check
- object-classification context
- low-light / phone-motion quality
- environmental sensor novelty
- external sensor contribution
- consensus frame count and persistence time
- a plain-language explanation summary

`explanation.json` is stored inside the event bundle and covered by the SHA-256 manifest.

## Session timeline and replay

SenseVeil writes a throttled session `timeline.jsonl` containing the important detector and sensor state approximately twice per second. Event markers link evidence bundles back to the session.

The in-app **Session Replay** view presents the most recent states without pretending to reconstruct anything the sensors did not measure.

## Stronger evidence windows

Event bundles now contain both:

- `telemetry_pre.csv` and `telemetry_window.csv`
- `detections_pre.jsonl` and `detections_window.jsonl`

The window covers roughly 30 seconds before and 10 seconds after the event when the app stays active long enough to complete the post-event write.

## External sensor safety

External readings expire after a short freshness window in the live fusion path. A disconnected radar therefore cannot remain permanently "present" in the UI.

The bridge protocol also supports an identification handshake:

`SV1|HELLO|ID=radar-01|CAP=RADAR,RANGING|FW=1.2.0|SRC=garage-radar`

USB devices visible to Android can be listed in the Sensor Adapters panel. Communication with a specific device still requires a compatible transport adapter and user-granted USB/BLE access where Android requires it.

## Alert behavior

Alert mode is stored locally and can cycle through:

- Silent
- Haptic
- Strong haptic

Automatic capture is latched to one capture per sustained anomaly episode, with the profile cooldown still protecting against rapid retriggers after the episode clears.
