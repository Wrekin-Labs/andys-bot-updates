# SenseVeil AI v0.6 upgrades

v0.6 focuses on evidence security, recovery and field reliability.

## Added
- Streaming AES-256-GCM `.sve` secure evidence vault using Android Keystore keys.
- ECDSA P-256 device signing of the SHA-256 evidence manifest.
- In-app evidence verification for the latest event bundle.
- Import and verification of SenseVeil ZIP evidence and same-device `.sve` vault files.
- Safe ZIP extraction with path-traversal protection.
- Interrupted-session recovery. Active sessions left by a crash/process termination are preserved and marked recovered on next launch.
- Atomic session metadata writes.
- Retention policy with age and storage-cap housekeeping.
- Device-health report for battery, charging state, thermal throttling and available storage.
- ARCore configured as optional with an AR/depth capability report. Normal CameraX scanning remains the fallback.
- ARCore SDK 1.46.0 integration boundary; depth is not described as through-wall sensing.
- Clear share ZIPs are written only to cache and scheduled for deletion after sharing; encrypted `.sve` copies stay in the app evidence vault when enabled.

## Evidence trust model
SenseVeil signatures prove that a manifest was signed by the app's device-held key and that files still match that manifest. They are not an external trusted timestamp, identity certificate, or proof that an AI interpretation is correct.

## Privacy
- No location permission is requested.
- Microphone monitoring remains opt-in.
- Android backup remains disabled for evidence.
- Cleartext networking remains disabled.
- Evidence vault encryption keys are non-exportable Android Keystore keys.

## Evidence trust & retention hardening
- Tools now exposes **Device Signer ID**, the SHA-256 fingerprint of the installation's ECDSA P-256 public key. Record this independently to recognise evidence signed by this installation later.
- Verification distinguishes cryptographic validity from trust in the current device's signer. A valid signature is not claimed to be an external timestamp or identity certificate.
- Retention applies to complete raw `Event_...` bundles plus encrypted `.sve` vault archives and export ZIPs. Storage-cap cleanup deletes complete evidence units oldest-first rather than individual files inside an event.
- Secure Vault creates an encrypted archival copy; raw app-private event bundles remain available for in-app history until retention cleanup.
