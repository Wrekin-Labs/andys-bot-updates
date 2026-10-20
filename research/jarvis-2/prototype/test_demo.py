import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


class ProcessRecoveryTests(unittest.TestCase):
    def run_step(self, workspace, step, expected=0):
        result = subprocess.run(
            [sys.executable, str(Path(__file__).with_name('demo.py')),
             step, '--workspace', workspace],
            capture_output=True, text=True, timeout=10, check=False)
        self.assertEqual(result.returncode, expected, result.stdout + result.stderr)
        return json.loads(result.stdout)

    def test_normal_workflow_across_processes(self):
        with tempfile.TemporaryDirectory() as root:
            self.assertEqual(self.run_step(root, 'prepare')['state'], 'awaiting_approval')
            self.assertEqual(self.run_step(root, 'status')['fake_provider_operations'], 0)
            self.assertEqual(self.run_step(root, 'approve-run')['state'], 'completed')
            self.run_step(root, 'approve-run', expected=2)
            self.assertEqual(self.run_step(root, 'status')['fake_provider_operations'], 1)

    def test_crash_recovery_blocks_duplicate_across_processes(self):
        with tempfile.TemporaryDirectory() as root:
            self.run_step(root, 'prepare')
            self.run_step(root, 'crash', expected=75)
            self.assertEqual(self.run_step(root, 'status')['state'], 'running')
            recovered = self.run_step(root, 'recover')
            self.assertEqual(recovered['state'], 'unknown')
            self.assertEqual(recovered['fake_provider_operations'], 1)
            self.run_step(root, 'approve-run', expected=2)
            self.assertEqual(self.run_step(root, 'status')['fake_provider_operations'], 1)


if __name__ == '__main__':
    unittest.main()
