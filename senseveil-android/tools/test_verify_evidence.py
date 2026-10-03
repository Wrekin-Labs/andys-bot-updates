import base64
import hashlib
import io
import json
from pathlib import Path
import subprocess
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
        for entries in (['../outside'], ['/absolute'], ['a\\b'], ['same', 'same']):
            data = io.BytesIO()
            with zipfile.ZipFile(data, 'w') as z:
                for name in entries:
                    z.writestr(name, 'payload')
            data.seek(0)
            with zipfile.ZipFile(data) as z, self.assertRaises((ValueError, RuntimeError)):
                verifier.safe_extract(z, self.root / 'extracted')

    def test_real_ecdsa_signature_and_wrong_signature(self):
        key, public, signature = self.root / 'key.pem', self.root / 'pub.der', self.root / 'sig.bin'
        def run(*args):
            subprocess.run(['openssl', *map(str, args)], check=True, capture_output=True)
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


if __name__ == '__main__':
    unittest.main()
