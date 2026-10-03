# Security & privacy notes

- Camera analysis is designed to run on-device.
- Location is not requested by default.
- Microphone level monitoring is opt-in and rolling video uses audio disabled.
- Android backup is disabled for the app.
- Clear-text network traffic is disabled.
- Evidence sharing uses `FileProvider` content URIs rather than raw file URIs.
- Evidence bundles include SHA-256 hashes so later file changes can be detected.
- External-sensor inputs are treated as measurements with timestamps/source labels, not as proof of identity or paranormal causes.

## v0.6 evidence model
SenseVeil signs each integrity manifest with a device-held Android Keystore ECDSA P-256 key. The export carries the public key and SHA-256 signer fingerprint. A signature can prove that the signed manifest has not changed relative to that key, but it does not by itself prove a person's identity or provide an independent trusted timestamp. Record the Device Signer ID separately if provenance matters.

Secure Vault uses streaming AES-256-GCM with an Android Keystore key to create an encrypted `.sve` archival copy. Raw event bundles remain in the app's private external-files area for history/review until configured retention removes them; Secure Vault is not whole-device storage encryption. Clear sharing ZIPs are created only in app cache and are scheduled for cleanup.

