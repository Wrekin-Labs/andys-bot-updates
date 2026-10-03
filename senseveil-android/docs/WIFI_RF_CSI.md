# SenseVeil Wi-Fi / CSI RF sensing (RC4)

SenseVeil RC4 adds two **opt-in** radio-sensing inputs. They are evidence channels, not person-detection channels.

## 1. Phone Wi-Fi survey

Tools → **WI-FI SURVEY** requests coarse + precise location together because Android still requires precise location permission for Wi-Fi scan results. SenseVeil does not read GPS coordinates. It stores only aggregate values:

- visible access-point count;
- strongest and median RSSI;
- counts in 2.4 GHz, 5 GHz and 6 GHz bands.

SSID and BSSID values are never written to SenseVeil evidence or session files.

Android may throttle Wi-Fi scans. A throttled scan remains visible as an unavailable/throttled status and is not treated as an anomaly.

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

Missing bridge data becomes `STALE` after 2.5 seconds. Low-rate, invalid and out-of-order frames become unavailable/rejected rather than detections.

Use **RF BASELINE RESET** after moving the phone, antenna, access point or bridge.

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
