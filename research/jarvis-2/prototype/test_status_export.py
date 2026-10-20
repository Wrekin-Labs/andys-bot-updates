import hashlib
from html.parser import HTMLParser
from pathlib import Path
import sqlite3
import tempfile
import unittest

from status_export import demo_snapshot, read_snapshot, render
from task_store import TaskStore


class DashboardTests(unittest.TestCase):
    def test_read_only_export_preserves_database_and_omits_private_fields(self):
        with tempfile.TemporaryDirectory() as directory:
            db = Path(directory) / 'tasks.sqlite3'
            store = TaskStore(db, 'owner')
            tid = store.create('owner', 'demo.send', 'fake:private-recipient',
                               {'text': 'private-body-sentinel'}, 'private-operation-key')
            token = store.approve('owner', tid, store.get('owner', tid)['digest'])
            before = hashlib.sha256(db.read_bytes()).hexdigest()
            document = render(read_snapshot(db))
            self.assertEqual(hashlib.sha256(db.read_bytes()).hexdigest(), before)
            for private in ['private-recipient', 'private-body-sentinel', 'private-operation-key', token]:
                self.assertNotIn(private, document)

    def test_missing_database_is_not_created(self):
        with tempfile.TemporaryDirectory() as directory:
            db = Path(directory) / 'missing.sqlite3'
            with self.assertRaises(sqlite3.OperationalError):
                read_snapshot(db)
            self.assertFalse(db.exists())

    def test_demo_contains_expected_states(self):
        snapshot = demo_snapshot()
        self.assertEqual(snapshot['counts'], {'unknown': 1, 'cancelled': 1,
                                             'completed': 1, 'awaiting_approval': 1})
        self.assertEqual(len(snapshot['tasks']), 4)

    def test_task_identity_is_escaped_and_unknown_state_is_normalised(self):
        with tempfile.TemporaryDirectory() as directory:
            db = Path(directory) / 'tasks.sqlite3'
            store = TaskStore(db, 'owner')
            tid = store.create('owner', 'demo.preview', 'fake:inbox', {}, 'one')
            with sqlite3.connect(db) as connection:
                connection.execute('UPDATE tasks SET id=?,state=? WHERE id=?',
                                   ('<img src=x onerror=alert(1)>', 'injected-state', tid))
            document = render(read_snapshot(db))
            self.assertNotIn('<img', document)
            self.assertIn('&lt;img', document)
            self.assertNotIn('injected-state', document)

    def test_html_has_no_remote_resources_or_forms(self):
        class Inspector(HTMLParser):
            def handle_starttag(self, tag, attrs):
                if tag in ('iframe', 'form', 'img', 'link'):
                    raise AssertionError(tag)
                if tag == 'script' and any(k == 'src' for k, _ in attrs):
                    raise AssertionError('External script')
        Inspector().feed(render(demo_snapshot(), sample=True))


if __name__ == '__main__':
    unittest.main()
