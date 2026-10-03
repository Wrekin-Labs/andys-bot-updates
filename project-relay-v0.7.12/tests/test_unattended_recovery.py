from __future__ import annotations

import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"


class UnattendedRecoveryTests(unittest.TestCase):
    def test_version_is_consistent(self) -> None:
        init_text = (ROOT / "project_relay" / "__init__.py").read_text(encoding="utf-8")
        pyproject = (ROOT / "pyproject.toml").read_text(encoding="utf-8")
        self.assertIn('__version__ = "0.7.12"', init_text)
        self.assertRegex(pyproject, r'(?m)^version = "0\.7\.12"$')

    def test_unattended_installer_is_fail_closed(self) -> None:
        text = (SCRIPTS / "install-unattended-recovery.ps1").read_text(encoding="utf-8")
        self.assertIn("-LogonType S4U", text)
        self.assertIn("dpapi_ok", text)
        self.assertIn("network_ok", text)
        self.assertIn("Test-IsAdministrator", text)
        self.assertNotIn("-LogonType Password", text)
        self.assertNotRegex(text, re.compile(r"(?i)password\s*="))

    def test_unattended_recovery_runs_at_boot_and_repeats(self) -> None:
        text = (SCRIPTS / "install-unattended-recovery.ps1").read_text(encoding="utf-8")
        self.assertIn("New-ScheduledTaskTrigger -AtStartup", text)
        self.assertIn("-RepetitionInterval (New-TimeSpan -Minutes 1)", text)
        self.assertIn("Project Relay Unattended Recovery", text)

    def test_interactive_logon_takes_over_agent_session(self) -> None:
        ensure = (SCRIPTS / "ensure-cloud-agent.ps1").read_text(encoding="utf-8")
        autostart = (SCRIPTS / "install-cloud-autostart.ps1").read_text(encoding="utf-8")
        self.assertIn("PreferInteractiveSession", ensure)
        self.assertIn("SessionId", ensure)
        self.assertIn("-PreferInteractiveSession", autostart)

    def test_probe_never_outputs_the_device_secret(self) -> None:
        text = (SCRIPTS / "probe-unattended-recovery.ps1").read_text(encoding="utf-8")
        self.assertIn("load_cloud_secret('device')", text)
        self.assertIn("print('OK' if bool(", text)
        self.assertNotIn("print(load_cloud_secret", text)


if __name__ == "__main__":
    unittest.main()
