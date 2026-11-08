from __future__ import annotations
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from project_relay.approvals import ApprovalStore
from project_relay import owner_full_control, root_policy

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("submission_validator", ROOT / "scripts" / "validate-plugin-submission.py")
validator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validator)

class SubmissionRegressionTests(unittest.TestCase):
    def test_bom_json_is_accepted(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "manifest.json"
            p.write_text('{"version":"0.7.12"}', encoding="utf-8-sig")
            self.assertEqual(validator.load_json(p)["version"], "0.7.12")

    def test_non_object_manifest_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "manifest.json"
            p.write_text("[]", encoding="utf-8")
            with self.assertRaises(validator.ValidationError):
                validator.load_json(p)

    def test_bom_toml_reaches_missing_plugin_check(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "pyproject.toml").write_text('[project]\nversion="0.7.12"\n', encoding="utf-8-sig")
            with patch.object(validator, "ROOT", root), patch.object(validator, "PLUGIN_DIR", root / "absent"):
                with self.assertRaises(FileNotFoundError):
                    validator.validate_static()

class ApprovalSecurityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.store = ApprovalStore(Path(self.temp.name) / "approvals.json")
        self.record = self.store.create("write", "fixture-device", {"path": "fixture"}, "test")
        self.request = dict(action="write", device_id="fixture-device", arguments={"path": "fixture"})

    def test_pending_is_denied(self):
        with self.assertRaises(PermissionError):
            self.store.consume(self.record.approval_id, **self.request)

    def test_exact_approval_is_single_use(self):
        self.store.approve(self.record.approval_id)
        self.store.consume(self.record.approval_id, **self.request)
        with self.assertRaises(PermissionError):
            self.store.consume(self.record.approval_id, **self.request)

    def test_expired_approval_is_denied(self):
        self.store.approve(self.record.approval_id)
        with self.assertRaises(PermissionError):
            self.store.consume(self.record.approval_id, now=self.record.expires_at + 1, **self.request)

    def test_changed_arguments_are_denied_without_consuming(self):
        self.store.approve(self.record.approval_id)
        with self.assertRaises(PermissionError):
            self.store.consume(self.record.approval_id, action="write", device_id="fixture-device", arguments={"path": "other"})
        self.assertIsNone(self.store.get(self.record.approval_id).consumed_at)
        self.store.consume(self.record.approval_id, **self.request)

    def test_other_device_is_denied(self):
        self.store.approve(self.record.approval_id)
        with self.assertRaises(PermissionError):
            self.store.consume(self.record.approval_id, action="write", device_id="other", arguments={"path": "fixture"})

    def test_other_action_is_denied(self):
        self.store.approve(self.record.approval_id)
        with self.assertRaises(PermissionError):
            self.store.consume(self.record.approval_id, action="delete", device_id="fixture-device", arguments={"path": "fixture"})

    def test_unknown_approval_is_denied(self):
        with self.assertRaises(KeyError):
            self.store.consume("unknown", **self.request)

    def test_corrupt_store_fails_closed(self):
        self.store.path.write_text("{broken", encoding="utf-8")
        with self.assertRaises(json.JSONDecodeError):
            self.store.consume(self.record.approval_id, **self.request)

class LocalGateSecurityTests(unittest.TestCase):
    def test_missing_owner_setting_denies_access(self):
        with tempfile.TemporaryDirectory() as d, patch.object(owner_full_control, "_path", return_value=Path(d) / "absent"):
            with self.assertRaises(PermissionError):
                owner_full_control.require_enabled()

    def test_malformed_owner_setting_denies_access(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "owner.json"
            for content in ('{broken', '{"enabled":"true"}', '{"enabled":false}'):
                with self.subTest(content=content):
                    p.write_text(content, encoding="utf-8")
                    with patch.object(owner_full_control, "_path", return_value=p):
                        with self.assertRaises(PermissionError):
                            owner_full_control.require_enabled()

    def test_malformed_roots_grant_no_access(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "roots.json"
            p.write_text('{"roots":"C:/"}', encoding="utf-8")
            with patch.object(root_policy, "_path", return_value=p):
                self.assertEqual(root_policy.configured_roots(), [])

if __name__ == "__main__":
    unittest.main()
