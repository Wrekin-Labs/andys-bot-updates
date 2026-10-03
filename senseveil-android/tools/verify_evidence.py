#!/usr/bin/env python3
"""Independent SenseVeil evidence verifier.

Requires Python 3 and OpenSSL for ECDSA verification. On Windows it also checks common Git-for-Windows OpenSSL locations when `openssl` is not on PATH.
Verifies ZIP bundles exported by SenseVeil. Encrypted .sve vaults remain device-bound
and should be decrypted/exported by the originating Android installation first.
"""
from __future__ import annotations
import argparse, base64, hashlib, json, os, re, shutil, stat, subprocess, sys, tempfile, zipfile
from pathlib import Path

MAX_ENTRIES = 512
MAX_TOTAL = 2 * 1024 * 1024 * 1024
MAX_SINGLE = 1024 * 1024 * 1024

def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()

def checked_path(root: Path, name: str) -> Path:
    if not name or "\\" in name or ":" in name or any(p in ("", ".", "..") for p in name.split("/")):
        raise ValueError("unsafe path: " + name)
    target = (root / name).resolve()
    if not target.is_relative_to(root.resolve()):
        raise ValueError("path outside bundle")
    return target

def safe_extract(zf: zipfile.ZipFile, dst: Path) -> None:
    total = 0
    infos = zf.infolist()
    if len(infos) > MAX_ENTRIES:
        raise RuntimeError('archive has too many entries')
    seen = set()
    for info in infos:
        target = checked_path(dst, info.filename.rstrip('/'))
        if target in seen or stat.S_ISLNK(info.external_attr >> 16):
            raise RuntimeError('duplicate or symlink archive entry')
        seen.add(target)
        if info.is_dir():
            target.mkdir(parents=True, exist_ok=True)
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        size = 0
        with zf.open(info) as source, target.open('wb') as output:
            for block in iter(lambda: source.read(65536), b''):
                size += len(block)
                total += len(block)
                if size > MAX_SINGLE or total > MAX_TOTAL:
                    raise RuntimeError('archive expands beyond safety limit')
                output.write(block)

def locate_bundle(root: Path) -> Path:
    if (root / 'integrity.json').exists():
        return root
    candidates = [p.parent for p in root.rglob('integrity.json')]
    if len(candidates) != 1:
        raise RuntimeError(f'expected exactly one evidence bundle, found {len(candidates)}')
    return candidates[0]

def verify_hashes(bundle: Path) -> tuple[int, list[str]]:
    manifest_path = bundle / 'integrity.json'
    if manifest_path.stat().st_size > 1024*1024:
        raise ValueError('manifest too large')
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    rows = manifest.get('files')
    if not isinstance(rows, list) or not 1 <= len(rows) <= MAX_ENTRIES:
        return 0, ['invalid manifest file list']
    failures, listed = [], set()
    checked = 0
    controls = {'integrity.json', 'integrity.sig.json'}
    for row in rows:
        if not isinstance(row, dict):
            failures.append('invalid manifest row')
            continue
        rel = row.get('path', '')
        try:
            target = checked_path(bundle, rel)
            if rel in controls or rel in listed:
                raise ValueError('duplicate or reserved path')
            listed.add(rel)
            expected = row.get('sha256', '')
            if not isinstance(expected, str) or not re.fullmatch(r'[0-9a-fA-F]{64}', expected):
                raise ValueError('invalid SHA-256')
            checked += 1
            if not target.is_file():
                failures.append(f'{rel}: missing')
            elif 'bytes' in row and row['bytes'] != target.stat().st_size:
                failures.append(f'{rel}: size mismatch')
            elif sha256(target).lower() != expected.lower():
                failures.append(f'{rel}: hash mismatch')
        except (ValueError, TypeError, OSError) as error:
            failures.append(f'{rel}: {error}')
    for file in bundle.rglob('*'):
        if file.is_file():
            rel = file.relative_to(bundle).as_posix()
            if rel not in listed and rel not in controls:
                failures.append(f'{rel}: not signed by manifest')
    return checked, failures

def find_openssl() -> str | None:
    found = shutil.which('openssl')
    if found:
        return found
    if os.name == 'nt':
        candidates = [
            Path(os.environ.get('ProgramFiles', r'C:\Program Files')) / 'Git' / 'usr' / 'bin' / 'openssl.exe',
            Path(os.environ.get('ProgramFiles', r'C:\Program Files')) / 'Git' / 'mingw64' / 'bin' / 'openssl.exe',
            Path(os.environ.get('ProgramFiles(x86)', r'C:\Program Files (x86)')) / 'Git' / 'usr' / 'bin' / 'openssl.exe',
        ]
        for candidate in candidates:
            if candidate.is_file():
                return str(candidate)
    return None

def verify_signature(bundle: Path) -> tuple[bool, str | None, str]:
    env_path = bundle / 'integrity.sig.json'
    if not env_path.exists():
        return False, None, 'signature envelope missing'
    env = json.loads(env_path.read_text(encoding='utf-8'))
    sig = base64.b64decode(env['signatureBase64'], validate=True)
    pub = base64.b64decode(env['publicKeyDerBase64'], validate=True)
    fp = hashlib.sha256(pub).hexdigest()
    claimed = env.get('signerFingerprintSha256', '')
    if claimed and claimed.lower() != fp:
        return False, fp, 'public-key fingerprint mismatch'
    openssl = find_openssl()
    if not openssl:
        return False, fp, 'openssl not found; hashes can be checked but ECDSA signature cannot'
    with tempfile.TemporaryDirectory(prefix='senseveil-sig-') as td:
        td = Path(td)
        der, pem, sigf = td/'pub.der', td/'pub.pem', td/'sig.bin'
        der.write_bytes(pub); sigf.write_bytes(sig)
        c1 = subprocess.run([openssl, 'pkey', '-pubin', '-inform', 'DER', '-in', str(der), '-out', str(pem)], capture_output=True, text=True)
        if c1.returncode != 0:
            return False, fp, 'failed to decode public key'
        c2 = subprocess.run([openssl, 'dgst', '-sha256', '-verify', str(pem), '-signature', str(sigf), str(bundle/'integrity.json')], capture_output=True, text=True)
        ok = c2.returncode == 0 and 'Verified OK' in (c2.stdout + c2.stderr)
        return ok, fp, 'ECDSA signature valid' if ok else 'ECDSA signature invalid'

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('evidence_zip', type=Path)
    ap.add_argument('--expect-fingerprint', help='optional 64-hex signer fingerprint to require')
    args = ap.parse_args()
    if args.evidence_zip.suffix.lower() == '.sve':
        print('ERROR: .sve is Android-Keystore encrypted. Export a clear verification ZIP from the originating installation first.', file=sys.stderr)
        return 2
    with tempfile.TemporaryDirectory(prefix='senseveil-verify-') as td:
        with zipfile.ZipFile(args.evidence_zip, 'r') as zf:
            safe_extract(zf, Path(td))
        bundle = locate_bundle(Path(td))
        checked, failures = verify_hashes(bundle)
        sig_ok, fp, sig_msg = verify_signature(bundle)
        expected_ok = True
        if args.expect_fingerprint:
            expected_ok = fp is not None and fp.lower() == args.expect_fingerprint.lower().replace(':','')
        print(f'Files checked: {checked}')
        print(f'Hash status: {"PASS" if not failures else "FAIL"}')
        for failure in failures:
            print(f'  - {failure}')
        print(f'Signature: {"PASS" if sig_ok else "FAIL"} ({sig_msg})')
        print(f'Signer fingerprint: {fp or "unknown"}')
        if args.expect_fingerprint:
            print(f'Expected signer: {"MATCH" if expected_ok else "MISMATCH"}')
        ok = not failures and sig_ok and expected_ok
        print(f'OVERALL: {"VERIFIED" if ok else "NOT VERIFIED"}')
        return 0 if ok else 1

if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (ValueError, KeyError, OSError, RuntimeError, zipfile.BadZipFile) as error:
        print(f'NOT VERIFIED: {error}', file=sys.stderr)
        raise SystemExit(2)
