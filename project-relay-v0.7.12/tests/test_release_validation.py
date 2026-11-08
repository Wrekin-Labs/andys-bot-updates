import importlib.util
import io
import re
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch
from project_relay import update_health, post_update

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('release_validator', ROOT / 'scripts/validate-plugin-submission.py')
v = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v)

class Response(io.BytesIO):
    status = 200

class LiveCheckTests(unittest.TestCase):
    def error(self, code):
        return urllib.error.HTTPError(v.SITE, code, 'fixture', {}, io.BytesIO(b'{}'))

    def test_public_page_retries_transient_failure(self):
        with patch.object(v.urllib.request, 'urlopen', side_effect=[self.error(503), Response(b'')]) as call, patch.object(v.time, 'sleep'):
            self.assertEqual(v.request_status(v.SITE), 200)
            self.assertEqual(call.call_count, 2)

    def test_public_page_never_retries_forbidden(self):
        with patch.object(v.urllib.request, 'urlopen', side_effect=self.error(403)) as call, patch.object(v.time, 'sleep') as sleep:
            self.assertEqual(v.request_status(v.SITE), 403)
            self.assertEqual(call.call_count, 1)
            sleep.assert_not_called()

    def test_retry_budget_is_bounded(self):
        with patch.object(v.urllib.request, 'urlopen', side_effect=[self.error(503), self.error(503)]) as call, patch.object(v.time, 'sleep'):
            self.assertEqual(v.request_status(v.SITE), 503)
            self.assertEqual(call.call_count, 2)

    def test_json_get_retries_transient_failure(self):
        with patch.object(v.urllib.request, 'urlopen', side_effect=[self.error(502), Response(b'{"ok":true}')]), patch.object(v.time, 'sleep'):
            self.assertEqual(v.request_json(v.SITE), (200, {'ok': True}))

    def test_json_post_does_not_replay_http_failure(self):
        with patch.object(v.urllib.request, 'urlopen', side_effect=self.error(503)) as call:
            self.assertEqual(v.request_json(v.SITE, method='POST', body={})[0], 503)
            self.assertEqual(call.call_count, 1)

    def test_json_forbidden_is_preserved(self):
        with patch.object(v.urllib.request, 'urlopen', side_effect=self.error(403)) as call:
            self.assertEqual(v.request_json(v.SITE)[0], 403)
            self.assertEqual(call.call_count, 1)

    def test_recovered_hosted_contract_is_found(self):
        contract = v.local_hosted_contract()
        self.assertEqual(contract['version'], '0.7.12')
        self.assertIn('list_workstations', contract['tools'])

    def test_all_hosted_version_fields_match_package(self):
        source = v.HOSTED_MCP_SOURCE.read_text()
        versions = re.findall(r'(?:version:|hosted_version:|hostedVersion=)"([0-9.]+)"', source)
        self.assertEqual(versions, ['0.7.12'] * 3)

    def test_version_drift_is_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            source = Path(d) / 'index.ts'
            source.write_text(v.HOSTED_MCP_SOURCE.read_text().replace('0.7.12', '0.7.11'))
            with patch.object(v, 'HOSTED_MCP_SOURCE', source):
                with self.assertRaisesRegex(v.ValidationError, 'does not match'):
                    v.local_hosted_contract()

class RecoveryBehaviorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        for module, name in ((update_health, 'health.json'), (post_update, 'pending.json')):
            p = patch.object(module, '_path', return_value=root / name)
            p.start()
            self.addCleanup(p.stop)

    def test_repeated_failure_backs_off_then_recovers(self):
        for i in range(3):
            update_health.record_failure('0.7.12', now=100+i)
        self.assertFalse(update_health.can_attempt(103))
        self.assertTrue(update_health.can_attempt(102 + update_health.BACKOFF_SECONDS))
        update_health.record_success('0.7.12', now=200)
        self.assertTrue(update_health.can_attempt(201))
        self.assertEqual(update_health.public_status(201)['consecutive_failures'], 0)

    def test_matching_healthy_version_clears_pending(self):
        post_update.mark_pending(post_update.__version__, now=100)
        self.assertTrue(post_update.confirm_healthy(101)['confirmed'])
        self.assertIsNone(post_update.pending())

    def test_mismatched_version_preserves_pending(self):
        post_update.mark_pending('0.0.0', now=100)
        self.assertEqual(post_update.confirm_healthy(101)['reason'], 'version-mismatch')
        self.assertIsNotNone(post_update.pending())

    def test_expired_health_window_is_not_success(self):
        post_update.mark_pending(post_update.__version__, now=100)
        self.assertEqual(post_update.confirm_healthy(100 + post_update.HEALTH_WINDOW_SECONDS + 1)['reason'], 'health-window-expired')
        self.assertIsNotNone(post_update.pending())
