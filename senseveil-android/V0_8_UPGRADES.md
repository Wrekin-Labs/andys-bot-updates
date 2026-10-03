# SenseVeil AI v0.8 upgrades

## Chain of custody
- Every session timeline sample now contains `chainPrev` and `chainHash` fields.
- SHA-256 hash chaining makes removal, reordering, or silent modification of timeline rows detectable.
- Session Replay reports whether the latest timeline chain verifies.

## External sensor anti-replay
- `SV1` readings can now include `SEQ=<monotonic sequence>` and `TS=<sensor epoch ms>`.
- SenseVeil rejects duplicate/replayed sequence numbers, stale packets, materially out-of-order timestamps, and timestamps too far in the future.
- The phone receive timestamp is still recorded separately.

## Trusted signer pinning
- Imported evidence still treats cryptographic validity and identity/trust as separate concepts.
- Operators can explicitly pin an imported ECDSA public-key fingerprint after verification.
- Pinned signer fingerprints are shown separately from the local device signing identity.

## Operator controls
- Auto-capture can be disabled while keeping live detection active.
- Added Quality / Balanced / Battery Saver operator performance preference for future runtime tuning.

## Human-readable evidence
- Every event bundle now includes `report.txt` with the detection reason, confidence, track, profile, scene quality, consensus, environment readings, and interpretation limitations.
- `report.txt` is covered by the existing integrity manifest and ECDSA signature when exported.
