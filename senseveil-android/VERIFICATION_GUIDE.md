# Independent evidence verification

SenseVeil exports a ZIP containing an `integrity.json` SHA-256 manifest and an `integrity.sig.json` ECDSA P-256 signature envelope.

## Desktop verification

Requirements:
- Python 3
- OpenSSL on PATH

Run:

```bash
python tools/verify_evidence.py /path/to/Event_....zip
```

To require a previously recorded signer fingerprint:

```bash
python tools/verify_evidence.py evidence.zip --expect-fingerprint 0123...abcd
```

The verifier checks safe extraction, every file hash, the public-key fingerprint, and the ECDSA signature over `integrity.json`.

## Trust model

A successful signature proves that the manifest was signed by the private key corresponding to the embedded public key and that the listed files still match the manifest. It does **not** by itself prove who owned the phone, when an external event occurred, or that an AI interpretation is correct. Record the device signer fingerprint independently if provenance matters.

`.sve` vault files use a key held by Android Keystore and are intentionally device-bound. Export a verification ZIP from the originating SenseVeil installation before using the desktop verifier.
