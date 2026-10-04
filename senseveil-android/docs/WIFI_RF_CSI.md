# SenseVeil Wi-Fi / CSI RF sensing (RC5)

SenseVeil RC5 includes two **opt-in** radio-sensing inputs. They are evidence channels, not person-detection channels.

## 1. Phone Wi-Fi survey

Tools → **WI-FI SURVEY** requests coarse + precise location together because Android still requires precise location permission for Wi-Fi scan results. SenseVeil does not read GPS coordinates. It stores only aggregate values:

- visible access-point count;
- strongest and median RSSI;
- counts in 2.4 GHz, 5 GHz and 6 GHz bands.

SSID and BSSID values are never written to SenseVeil evidence or session files.

Android may throttle Wi-Fi scans, and Android Wi-Fi scanning also requires Location services to be enabled. A throttled/unavailable scan is reported as such and is not treated as an anomaly.

## 2. External CSI/RF bridge

Tools → **RF BRIDGE SETUP** configures a LAN host, TCP port and generated pairing code. On Android 17/API 37, enabling the bridge requests **Local Network** access at runtime. The bridge is disabled by default.

Default endpoint: `192.168.4.1:8765`.

The phone opens an outbound TCP connection and sends one newline-delimited JSON hello:

```json
{"type":"senseveil_hello","v":1,"pair":"<pair-code>"}
```

The bridge then sends newline-delimited JSON samples:

```json
{"v":1,"pair":"<pair-code>","source":"esp32-csi","seq":101,"epochMs":1791047000000,"sampleRateHz":20.0,"rssiDbm":-55.2,"csiAmplitude":0.84,"csiVariance":0.031}
```

Required fields are `v`, `pair`, `source`, `seq`, `epochMs` and `sampleRateHz`. At least one of `rssiDbm`, `csiAmplitude` or `csiVariance` must be present and finite.

The pairing code prevents accidental cross-feed between nearby test bridges. It is **not encryption or strong network authentication**. Use a trusted/private LAN for testing.

## RF-change algorithm

SenseVeil requires at least 4 samples/s and builds a 30-sample stationary baseline. Phone movement pauses RF-change classification. Once calibrated, RSSI/amplitude/variance changes are compared with the baseline. A change must remain above threshold for at least 5 frames and 800 ms before the state becomes `RF_CHANGE`.

Missing bridge data becomes `STALE` after 2.5 seconds. Low-rate, invalid and out-of-order frames become unavailable/rejected rather than detections. Each successful bridge reconnect clears the previous RF baseline and recalibrates before classification resumes.

Phone movement automatically invalidates the RF baseline; once the phone is stationary, SenseVeil requires a fresh calibration before RF-change classification resumes. Use **RF BASELINE RESET** after deliberately moving the antenna, access point or bridge, or whenever room geometry changes.

## Evidence

Signed session rows can include RF status, source, novelty, sustained-change state, sample rate, RSSI, CSI amplitude/variance, and aggregate Wi-Fi survey values. Captured evidence bundles also include `rf_pre.csv` and `rf_window.csv`.

RF/CSI values do **not** enter `FusionScorer`, human-pose confidence, face detection or automatic person classification.

## What this does and does not mean

Wi-Fi/CSI can react to changes in propagation caused by motion, people, doors, furniture, multipath and many other environmental effects when suitable external hardware is used. A radio change alone does not identify what caused it.

SenseVeil therefore reports **environmental RF change**, not “a person behind a wall,” a body image, a paranormal entity or a verified through-wall detection. Controlled field calibration with the actual ESP32/PC CSI hardware is still required.

## Mock bridge

`tools/rf_bridge/mock_rf_bridge.py` lets you verify the Android permission, TCP, pairing, calibration, stale-data and RF-change UI paths without pretending to be real CSI hardware.

Example:

```powershell
python tools\rf_bridge\mock_rf_bridge.py --pair <pair-code> --port 8765 --change-after 20
```

Connect the phone to the same private LAN, enter the PC IPv4 address and port in RF Bridge Setup, enable RF Bridge, and keep the phone stationary during calibration.

## RC5 hardening (proposed; evidence schema 4)

### Frame validation
- Lines longer than 2,048 bytes are discarded without being buffered. A stream with no newline for 128 KiB closes the connection.
- `v`, `seq` and `epochMs` must be JSON integers between 0 and 2^53−1. Strings, fractions and values like `1e300` are rejected.
- Measurements must be JSON numbers that are still finite after conversion to a 32-bit float. CSI amplitude must be ≤ 1e6 and CSI variance ≤ 1e9. An out-of-range value rejects the whole frame; it is no longer silently dropped.
- `source` must be 1–64 characters, start with a letter or digit, and use only `[A-Za-z0-9._:-]`. Sources that look like a MAC/BSSID are rejected, so device identifiers stay out of evidence.
- `"synthetic": true`, or any source starting with `mock`, marks the stream SYNTHETIC in the UI, session rows, event JSON and report.

### Timing
- `seq` remains the replay and order guard. Three consecutive rolled-back frames that increase among themselves are treated as a bridge counter restart: the baseline resets and the stream continues.
- `epochMs` does not need to match the phone's clock. ESP32 boards without NTP are fine; the reading records `sensorClockSynced = false`.
- A sensor-clock step backwards of more than 500 ms, or forwards of more than 10 s, resets the baseline.
- Change duration is measured in sensor time, so TCP bursts and Wi-Fi stalls cannot stretch or compress an episode.
- Frames delayed by more than 2 s relative to the least-delayed frame are displayed but never start or extend an RF-change episode.

### Algorithm `robust-mad-v2`
- The baseline is the per-channel median and MAD over 30 stationary frames. Each channel has a noise floor (RSSI ≥ 1.5 dB; amplitude ≥ 5 %; variance ≥ 25 %), so a quantised channel with zero spread cannot amplify tiny changes.
- A frame counts as positive at robust z ≥ 5.5. If two or more channels are present, a second channel must also be at z ≥ 2.5 to corroborate it.
- Entering RF_CHANGE needs 5 positive frames spanning ≥ 800 ms of sensor time. Up to 2 ambiguous frames are tolerated.
- Leaving RF_CHANGE needs 5 consecutive frames below z 3.5 (hysteresis).
- A change lasting 60 s re-baselines to the new environment, so a door left open does not latch RF_CHANGE forever.
- The baseline tracks slowly only while quiet. Drift beyond 3σ of the calibration spread forces recalibration.
- Classification is held when the measured frame rate is < 4 Hz or packet loss is > 30 %.
- Phone movement uses a debounced gate: movement registers immediately, but the phone must be quiet for 1.5 s before it counts as stationary again.
- Novelty is z/10, clamped to 0–1, so 55 % still corresponds to the entry threshold.

### Protocol v2 (optional, backwards compatible)
- The phone's hello becomes `{"type":"senseveil_hello","v":1,"pair":…,"nonce":"<32 hex>","maxV":2}`. v1 bridges ignore the extra fields.
- A v2 frame line is `SV2 <hex HMAC-SHA256> <json>` with `"v":2` and no `pair` field. The MAC is `HMAC(key, "senseveil-rf-v2\n" + nonce + "\n" + exact JSON bytes)`, using a fresh nonce per TCP connection.
- The key is 32 random bytes generated on the phone and typed into the bridge. It is never committed to Git. Once a key is configured, v1 frames are refused, so a connection cannot be downgraded to plaintext.
- The shared test vector lives in `tools/test_mock_rf_bridge.py` and `WifiRfHardeningTest.v2CrossLanguageVector`.
- v2 provides integrity and origin authentication only, with no confidentiality. TLS is not proposed for the ESP32 at this stage.

### Network policy
The bridge host must resolve to a loopback, RFC 1918, link-local or IPv6 ULA address. The advanced option "Allow non-local host" in RF Bridge Setup turns this off explicitly. The address is resolved once and the checked address is used, which also blocks DNS rebinding.

### Evidence schema 4 migration
All changes are additive:
- Events gain `rfSynthetic`, `rfAuth` and `rfAlgorithm`.
- Session rows gain `rfSynthetic`, `rfAuth`, `rfMeasuredRateHz` and `rfPacketLossPct`.
- `rf_pre.csv` / `rf_window.csv` gain six appended columns: `measured_rate_hz`, `packet_loss_pct`, `synthetic`, `auth`, `algorithm`, `survey_result_age_ms`. The first 17 columns are unchanged.
- Wi-Fi survey counts are **null when unknown** (permission missing, Location Services off, stale result). In RC4 these were recorded as `0`.

Schema 1–3 events and bundles still parse and verify; `EvidenceSchemaCompatibilityTest` covers this.

### Independent verifier exit codes
| Code | Meaning |
|---|---|
| 0 | Verified against `--expect-fingerprint` |
| 1 | Failed |
| 2 | Error |
| 3 | Self-consistent but the signer is not pinned. Same meaning as the Android "signer must be trusted separately" result. |

ZIPs containing case-, Unicode- or trailing-dot aliases, Windows device names, or files outside the signed bundle are rejected or flagged.
