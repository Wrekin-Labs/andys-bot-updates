from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch, Mock

import rescue_host


class RescueHostTests(unittest.TestCase):
    def test_tailnet_and_loopback_only(self):
        self.assertTrue(rescue_host.is_trusted_peer('127.0.0.1'))
        self.assertTrue(rescue_host.is_trusted_peer('100.73.95.89'))
        self.assertFalse(rescue_host.is_trusted_peer('192.168.1.2'))
        self.assertFalse(rescue_host.is_trusted_peer('8.8.8.8'))

    def test_token_persists(self):
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / 'token'
            a = rescue_host.load_or_create_token(p)
            b = rescue_host.load_or_create_token(p)
            self.assertEqual(a, b)
            self.assertGreaterEqual(len(a), 32)

    def test_control_lease_expires_and_revokes(self):
        lease = rescue_host.ControlLease(ttl=1)
        self.assertFalse(lease.active())
        lease.enable()
        self.assertTrue(lease.active())
        lease.disable()
        self.assertFalse(lease.active())

    def test_recovery_task_names_are_fixed(self):
        self.assertEqual(rescue_host.RECOVERY_TASKS, (
            'Project Relay Cloud Agent',
            'Project Relay Cloud Watchdog',
        ))

    def test_recovery_has_no_caller_supplied_command(self):
        fake = Mock(returncode=0, stdout='SUCCESS', stderr='')
        with patch.object(rescue_host.os, 'name', 'nt'), patch('rescue_host.subprocess.run', return_value=fake) as run:
            result = rescue_host.recover_project_relay()
        self.assertTrue(result['ok'])
        commands = [call.args[0] for call in run.call_args_list]
        self.assertEqual(commands[0], ['schtasks.exe', '/Run', '/TN', 'Project Relay Cloud Agent'])
        self.assertEqual(commands[1], ['schtasks.exe', '/Run', '/TN', 'Project Relay Cloud Watchdog'])


if __name__ == '__main__':
    unittest.main()
