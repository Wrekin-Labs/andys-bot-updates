import json
from pathlib import Path
import tempfile
import unittest
from mobile_export import mobile_snapshot, write_snapshot
from status_export import read_snapshot


class MobileExportTests(unittest.TestCase):
    def test_strips_private_fields(self):
        result = mobile_snapshot({'tasks': [{'id':'a', 'state':'unknown', 'token':'SECRET', 'intent':'PRIVATE'}]}, sample=True)
        self.assertEqual(result['tasks'], [{'id':'a', 'state':'unknown'}])
        self.assertTrue(result['sample'])
        self.assertNotIn('SECRET', json.dumps(result))
        self.assertNotIn('PRIVATE', json.dumps(result))

    def test_rejects_unknown_states(self):
        with self.assertRaises(ValueError):
            mobile_snapshot({'tasks':[{'id':'a','state':'pretend-success'}]})

    def test_task_limit(self):
        with self.assertRaises(ValueError):
            mobile_snapshot({'tasks':[{'id':'a','state':'queued'}]*501})

    def test_refuses_overwrite(self):
        with tempfile.TemporaryDirectory() as d:
            path=Path(d)/'snapshot.json'
            path.write_text('existing')
            with self.assertRaises(FileExistsError): write_snapshot(path, {'tasks':[]})
            self.assertEqual(path.read_text(), 'existing')

    def test_missing_database_not_created(self):
        with tempfile.TemporaryDirectory() as d:
            path=Path(d)/'missing.db'
            with self.assertRaises(Exception): read_snapshot(path)
            self.assertFalse(path.exists())

    def test_empty_snapshot(self):
        self.assertEqual(mobile_snapshot({'tasks':[]})['tasks'], [])
        self.assertFalse(mobile_snapshot({'tasks':[]})['sample'])

    def test_invalid_identity(self):
        for identity in ['', 'a'*101, 123]:
            with self.assertRaises(ValueError):
                mobile_snapshot({'tasks':[{'id':identity,'state':'queued'}]})
