import base64
import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile
import verify_evidence as verifier


class EvidenceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.bundle = self.root / 'bundle'
        self.bundle.mkdir()
        self.payload = self.bundle / 'event.json'
        self.payload.write_text('{"sample":1}')
        self.manifest = {'files': [{'path': 'event.json', 'bytes': self.payload.stat().st_size,
                                  'sha256': verifier.sha256(self.payload)}]}
        self.write_manifest()

    def write_manifest(self):
        (self.bundle / 'integrity.json').write_text(json.dumps(self.manifest))

    def test_valid_hashes_and_tampering(self):
        self.assertEqual((1, []), verifier.verify_hashes(self.bundle))
        self.payload.write_text('{"sample":2}')
        self.assertTrue(verifier.verify_hashes(self.bundle)[1])

    def test_unsigned_extra_file(self):
        (self.bundle / 'extra.txt').write_text('unsigned')
        self.assertIn('not signed', str(verifier.verify_hashes(self.bundle)[1]))

    def test_empty_duplicate_and_traversal_manifest(self):
        for rows in ([], self.manifest['files'] * 2, [{'path': '../outside', 'sha256': '0' * 64}]):
            self.manifest['files'] = rows
            self.write_manifest()
            self.assertTrue(verifier.verify_hashes(self.bundle)[1])

    def test_zip_rejects_duplicate_and_unsafe_paths(self):
        # zipfile normalizes backslashes while creating archives on Windows,
        # so exercise that path rule directly and keep archive cases portable.
        with self.assertRaises(ValueError):
            verifier.checked_path(self.root / 'extracted', 'a\\b')
        for entries in (['../outside'], ['/absolute'], ['same', 'same']):
            data = io.BytesIO()
            with zipfile.ZipFile(data, 'w') as z:
                for name in entries:
                    z.writestr(name, 'payload')
            data.seek(0)
            with zipfile.ZipFile(data) as z, self.assertRaises((ValueError, RuntimeError)):
                verifier.safe_extract(z, self.root / 'extracted')

    def test_real_ecdsa_signature_and_wrong_signature(self):
        key, public, signature = self.root / 'key.pem', self.root / 'pub.der', self.root / 'sig.bin'
        openssl = verifier.find_openssl()
        self.assertIsNotNone(openssl, 'OpenSSL is required for the ECDSA verifier test')
        def run(*args):
            subprocess.run([openssl, *map(str, args)], check=True, capture_output=True)
        run('ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', key)
        run('pkey', '-in', key, '-pubout', '-outform', 'DER', '-out', public)
        run('dgst', '-sha256', '-sign', key, '-out', signature, self.bundle / 'integrity.json')
        env = {'signatureBase64': base64.b64encode(signature.read_bytes()).decode(),
               'publicKeyDerBase64': base64.b64encode(public.read_bytes()).decode(),
               'signerFingerprintSha256': hashlib.sha256(public.read_bytes()).hexdigest()}
        (self.bundle / 'integrity.sig.json').write_text(json.dumps(env))
        self.assertTrue(verifier.verify_signature(self.bundle)[0])
        (self.bundle / 'integrity.json').write_text('{}')
        self.assertFalse(verifier.verify_signature(self.bundle)[0])


    # ---- RC5 hardening -------------------------------------------------------------------------

    def zip_of(self, entries):
        data = io.BytesIO()
        with zipfile.ZipFile(data, 'w') as z:
            for name, payload in entries:
                z.writestr(name, payload)
        data.seek(0)
        return zipfile.ZipFile(data)

    def test_case_and_unicode_aliases_rejected(self):
        # On Windows/macOS the second entry would overwrite the first, so the verified file
        # could differ from what a user later opens from the same archive.
        for entries in ([('report.txt', 'tampered'), ('REPORT.TXT', 'original')],
                        [('caf\u00e9.txt', 'a'), ('cafe\u0301.txt', 'b')]):
            with self.zip_of(entries) as z, self.assertRaises(RuntimeError):
                verifier.safe_extract(z, self.root / 'x')

    def test_windows_non_portable_names_rejected(self):
        for name in ('report.txt.', 'report.txt ', 'nul', 'NUL.txt', 'com1.csv', 'a/aux', 'bad\x01name'):
            with self.assertRaises(ValueError, msg=name):
                verifier.checked_path(self.root / 'x', name)
        verifier.checked_path(self.root / 'x', 'rf_window.csv')
        verifier.checked_path(self.root / 'x', 'console.txt')  # only exact device names are reserved

    def test_manifest_case_alias_duplicate_bool_size_and_duplicate_key(self):
        row = dict(self.manifest['files'][0])
        self.manifest['files'] = [row, dict(row, path='EVENT.json')]
        self.write_manifest()
        self.assertTrue(verifier.verify_hashes(self.bundle)[1])
        self.manifest['files'] = [dict(row, bytes=True)]
        self.write_manifest()
        self.assertTrue(verifier.verify_hashes(self.bundle)[1])
        (self.bundle / 'integrity.json').write_text('{"files":[],"files":' + json.dumps([row]) + '}')
        with self.assertRaises(ValueError):
            verifier.verify_hashes(self.bundle)

    def test_files_outside_wrapped_bundle_are_reported(self):
        outer = self.root
        (outer / 'smuggled.txt').write_text('not covered by the manifest')
        bundle = verifier.locate_bundle(outer)
        self.assertEqual(self.bundle, bundle)
        self.assertIn('smuggled.txt', str(verifier.outside_files(outer, bundle)))
        self.assertEqual([], verifier.outside_files(self.bundle, self.bundle))

    def test_cli_requires_pinned_signer_for_verified(self):
        openssl = verifier.find_openssl()
        self.assertIsNotNone(openssl)
        key, public, signature = self.root / 'k.pem', self.root / 'p.der', self.root / 's.bin'
        def run(*args):
            subprocess.run([openssl, *map(str, args)], check=True, capture_output=True)
        run('ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', key)
        run('pkey', '-in', key, '-pubout', '-outform', 'DER', '-out', public)
        run('dgst', '-sha256', '-sign', key, '-out', signature, self.bundle / 'integrity.json')
        fp = hashlib.sha256(public.read_bytes()).hexdigest()
        (self.bundle / 'integrity.sig.json').write_text(json.dumps({
            'signatureBase64': base64.b64encode(signature.read_bytes()).decode(),
            'publicKeyDerBase64': base64.b64encode(public.read_bytes()).decode(),
            'signerFingerprintSha256': fp}))
        archive = self.root / 'evidence.zip'
        with zipfile.ZipFile(archive, 'w') as z:
            for f in self.bundle.iterdir():
                z.write(f, f.name)
        script = Path(verifier.__file__)
        def cli(*extra):
            return subprocess.run([sys.executable, str(script), str(archive), *extra], capture_output=True, text=True)
        unpinned = cli()
        self.assertEqual(verifier.EXIT_UNPINNED, unpinned.returncode, unpinned.stdout)
        self.assertIn('SELF-CONSISTENT', unpinned.stdout)
        self.assertNotIn('OVERALL: VERIFIED', unpinned.stdout)
        pinned = cli('--expect-fingerprint', ':'.join(fp[i:i + 2] for i in range(0, 64, 2)))
        self.assertEqual(0, pinned.returncode, pinned.stdout)
        self.assertIn('OVERALL: VERIFIED', pinned.stdout)
        self.assertEqual(1, cli('--expect-fingerprint', '0' * 64).returncode)
        self.assertEqual(2, cli('--expect-fingerprint', 'nothex').returncode)


if __name__ == '__main__':
    unittest.main()
