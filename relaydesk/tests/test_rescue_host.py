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


    def test_heartbeat_health(self):
        with tempfile.TemporaryDirectory() as td:
            heartbeat = Path(td) / 'heartbeat.json'
            missing = rescue_host.relay_heartbeat_status(heartbeat)
            self.assertFalse(missing['healthy'])
            self.assertFalse(missing['present'])

            heartbeat.write_text('{}', encoding='utf-8')
            fresh = rescue_host.relay_heartbeat_status(heartbeat, stale_after=180)
            self.assertTrue(fresh['healthy'])
            self.assertTrue(fresh['present'])

            import os
            import time
            old = time.time() - 600
            os.utime(heartbeat, (old, old))
            stale = rescue_host.relay_heartbeat_status(heartbeat, stale_after=180)
            self.assertFalse(stale['healthy'])
            self.assertGreaterEqual(stale['age_seconds'], 590)

    def test_auto_recovery_tick_uses_cooldown(self):
        with tempfile.TemporaryDirectory() as td:
            heartbeat = Path(td) / 'missing-heartbeat.json'
            with patch('rescue_host.recover_project_relay', return_value={'ok': True, 'tasks': []}) as recover:
                first, result = rescue_host.auto_recovery_tick(
                    heartbeat_path=heartbeat,
                    last_attempt=0.0,
                    now_monotonic=1000.0,
                )
                self.assertEqual(first, 1000.0)
                self.assertIsNotNone(result)
                self.assertEqual(recover.call_count, 1)

                second, result2 = rescue_host.auto_recovery_tick(
                    heartbeat_path=heartbeat,
                    last_attempt=first,
                    now_monotonic=1050.0,
                )
                self.assertEqual(second, first)
                self.assertIsNone(result2)
                self.assertEqual(recover.call_count, 1)



if __name__ == '__main__':
    unittest.main()
