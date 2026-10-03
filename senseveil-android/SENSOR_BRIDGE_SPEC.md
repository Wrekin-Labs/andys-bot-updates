# SenseVeil External Sensor Bridge v1.1

SenseVeil's phone camera cannot see through walls. Non-line-of-sight presence data must come from compatible external hardware such as mmWave radar. The Android app treats that hardware as another evidence source rather than proof of any paranormal interpretation.

## Transport

Adapters may use BLE GATT notifications, USB serial, or a future local-network bridge. Each transport feeds complete UTF-8 lines into `ExternalSensorProtocol.parseMessage()`.

## Discovery handshake

On connection an adapter should emit one HELLO line:

`SV1|HELLO|ID=radar-01|CAP=RADAR,RANGING|FW=1.2.0|SRC=garage-radar`

- `ID` — stable adapter identifier.
- `CAP` — comma-separated `RADAR`, `THERMAL`, `DEPTH`, `RANGING` capabilities.
- `FW` — optional firmware version.
- `SRC` — human-readable source label.

## Reading format

`SV1|TYPE|P=0/1|C=0.00..1.00|D=metres|X=-1.00..1.00|V=m/s|T=celsius|SRC=name`

`P` and `C` are required. Other fields may be omitted.

Example:

`SV1|RADAR|P=1|C=0.88|D=3.20|X=-0.15|V=0.12|SRC=mmwave`

## Interpretation

- `RADAR`: presence/range from dedicated radar hardware, potentially non-line-of-sight depending on the sensor and wall material.
- `THERMAL`: temperature/presence from an external thermal imager; ordinary thermal imaging generally does not see through walls.
- `DEPTH`: scene depth from a supported depth source.
- `RANGING`: cooperative-device range such as UWB/Bluetooth/Wi-Fi ranging; this ranges known peers rather than discovering unknown people.

## Evidence rules

Every external reading must be timestamped and source-identified. SenseVeil displays sensor disagreement explicitly and does not relabel an unexplained reading as a person or paranormal entity without supporting evidence.


## v0.8 anti-replay fields
Adapters should include a monotonic sequence and sensor timestamp on readings:

`SV1|RADAR|P=1|C=0.88|D=3.20|SEQ=42|TS=1760000000000|SRC=radar-01`

- `SEQ` must increase for each reading from the same source. Duplicate or decreasing values are rejected.
- `TS` is epoch milliseconds from the sensor/bridge clock. Stale, materially out-of-order, and implausibly future readings are rejected.
- SenseVeil also records its own receive time.
