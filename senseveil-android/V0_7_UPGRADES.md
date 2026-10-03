# SenseVeil AI v0.7 upgrades

## Operational readiness
- Added **System Self-Test** for evidence storage, Android Keystore signing identity, streaming AES-GCM vault round-trip, device health, and camera feature availability.
- The self-test validates app plumbing, not sensor measurement accuracy.

## Evidence Review
- Added an in-app recent-evidence catalogue showing event time/type, confidence, track, profile, and presence of image/video/hash/signature/vault assets.
- Catalogue flags are inventory only; signature validity still requires the verifier.

## Retention hardening
- Retention and quota cleanup now delete complete `Event_...` bundles as units, plus vault `.sve` and export `.zip` archives.
- Oldest complete evidence units are removed first when the configured storage cap is exceeded.
- Orphaned rolling-video segments older than 24 hours are cleaned after interrupted/crashed sessions.

## Provenance
- Added **Device Signer ID** view exposing the full SHA-256 fingerprint of the device-held ECDSA P-256 key.
- Verification distinguishes cryptographic validity from trust in this installation's recorded signer fingerprint.
