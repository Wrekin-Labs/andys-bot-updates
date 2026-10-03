# SenseVeil AI v0.9 upgrades

## Hardened evidence imports
- Imported ZIP/SVE sources are bounded to prevent accidental or malicious oversized inputs.
- ZIP extraction enforces a 512-entry maximum, 1 GiB per-entry maximum, 2 GiB total extracted maximum, and canonical path traversal protection.
- Unknown-size content-provider streams are bounded while copying, not trusted blindly.

## Independent verification
- Added `tools/verify_evidence.py` for desktop verification of exported evidence ZIPs.
- The verifier checks path safety, SHA-256 file hashes, embedded signer fingerprint, and ECDSA signature using OpenSSL.
- Optional `--expect-fingerprint` allows a separately recorded signer fingerprint to be required.

## Trust wording
- Verification documentation explicitly separates file integrity from operator identity, external trusted time, and AI interpretation accuracy.
