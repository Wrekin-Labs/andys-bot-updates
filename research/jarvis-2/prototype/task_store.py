"""Offline task-ledger prototype. No network, shell or production adapters.

All callers are trusted local Python code. An authenticated owner UI and OS
access controls are required before exposing any of these methods to tools.
"""
from __future__ import annotations

from contextlib import contextmanager
import hashlib
import json
import math
import secrets
import sqlite3
import time
import uuid


class Denied(ValueError):
    pass


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)


class TaskStore:
    """One local worker; stop it before running crash recovery.

    This prototype permits only demo.preview and demo.send. It never sends
    anything. Operation keys are stable identifiers for later reconciliation.
    """
    ACTIONS = {"demo.preview": False, "demo.send": True}

    def __init__(self, path, owner_id, clock=time.time):
        if not isinstance(owner_id, str) or not owner_id.strip():
            raise Denied("Owner identity required")
        self.path, self.owner_id, self.clock = str(path), owner_id, clock
        with self._db() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS settings(owner TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS tasks(
                    id TEXT PRIMARY KEY, operation_key TEXT UNIQUE NOT NULL,
                    intent TEXT NOT NULL, digest TEXT NOT NULL,
                    needs_approval INTEGER NOT NULL, state TEXT NOT NULL,
                    token_hash TEXT, expiry REAL, receipt TEXT);
                CREATE TABLE IF NOT EXISTS audit(
                    seq INTEGER PRIMARY KEY, task_id TEXT NOT NULL,
                    event TEXT NOT NULL, at REAL NOT NULL);
            """)
            row = db.execute("SELECT owner FROM settings").fetchone()
            if row is None:
                db.execute("INSERT INTO settings VALUES (?)", (owner_id,))
            elif row[0] != owner_id:
                raise Denied("Store belongs to another owner")

    @contextmanager
    def _db(self):
        db = sqlite3.connect(self.path, timeout=5)
        db.row_factory = sqlite3.Row
        try:
            db.execute("BEGIN IMMEDIATE")
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    def _owner(self, owner):
        if owner != self.owner_id:
            raise Denied("Owner mismatch")

    def _row(self, db, task_id):
        row = db.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
        if row is None:
            raise Denied("Unknown task")
        return row

    def _log(self, db, task_id, event):
        # Never log payloads, approval tokens or receipts.
        db.execute("INSERT INTO audit(task_id,event,at) VALUES (?,?,?)",
                   (task_id, event, self.clock()))

    def create(self, owner, action, destination, payload, operation_key):
        self._owner(owner)
        if action not in self.ACTIONS:
            raise Denied("Unsupported action")
        if not isinstance(destination, str) or not destination or len(destination) > 300:
            raise Denied("Destination required")
        if not isinstance(operation_key, str) or not operation_key or len(operation_key) > 200:
            raise Denied("Operation key required")
        intent = canonical({"owner": owner, "action": action,
                            "destination": destination, "payload": payload})
        if len(intent.encode()) > 16000:
            raise Denied("Intent too large")
        digest = hashlib.sha256(intent.encode()).hexdigest()
        with self._db() as db:
            old = db.execute("SELECT * FROM tasks WHERE operation_key=?", (operation_key,)).fetchone()
            if old:
                if old["intent"] != intent:
                    raise Denied("Operation key reused for different intent")
                return old["id"]
            task_id = str(uuid.uuid4())
            approval = self.ACTIONS[action]
            db.execute("INSERT INTO tasks(id,operation_key,intent,digest,needs_approval,state) VALUES (?,?,?,?,?,?)",
                       (task_id, operation_key, intent, digest, approval,
                        "awaiting_approval" if approval else "queued"))
            self._log(db, task_id, "created")
            return task_id

    def get(self, owner, task_id):
        self._owner(owner)
        with self._db() as db:
            row = self._row(db, task_id)
            return {"id": row["id"], "operation_key": row["operation_key"],
                    "state": row["state"], "digest": row["digest"],
                    "intent": json.loads(row["intent"]), "receipt": row["receipt"]}

    def approve(self, owner, task_id, reviewed_digest, ttl=60):
        """Trusted UI calls after showing the exact intent; never an LLM tool."""
        self._owner(owner)
        if type(ttl) not in (int, float) or not math.isfinite(ttl) or not 0 < ttl <= 300:
            raise Denied("Invalid approval lifetime")
        with self._db() as db:
            row = self._row(db, task_id)
            if row["state"] != "awaiting_approval" or row["digest"] != reviewed_digest:
                raise Denied("Task no longer matches the reviewed intent")
            token = secrets.token_urlsafe(32)
            db.execute("UPDATE tasks SET token_hash=?,expiry=? WHERE id=?",
                       (hashlib.sha256(token.encode()).hexdigest(), self.clock()+ttl, task_id))
            self._log(db, task_id, "approval_granted")
            return token

    def claim(self, owner, task_id, token=None):
        """Atomically consume approval and persist dispatch intent before action."""
        self._owner(owner)
        with self._db() as db:
            row = self._row(db, task_id)
            if row["state"] not in ("queued", "awaiting_approval"):
                raise Denied("Task is not dispatchable")
            if row["needs_approval"]:
                token_hash = hashlib.sha256(token.encode()).hexdigest() if isinstance(token, str) else ""
                if (row["expiry"] is None or row["expiry"] <= self.clock()
                        or not row["token_hash"] or not secrets.compare_digest(token_hash, row["token_hash"])):
                    raise Denied("Valid owner approval required")
            db.execute("UPDATE tasks SET state='running',token_hash=NULL,expiry=NULL WHERE id=?", (task_id,))
            self._log(db, task_id, "dispatch_intent")
            return {"task_id": task_id, "operation_key": row["operation_key"],
                    "intent": json.loads(row["intent"])}

    def complete(self, owner, task_id, receipt):
        """Trusted fake adapter receipt, not proof of a real external action."""
        self._owner(owner)
        if not isinstance(receipt, str) or not receipt or len(receipt) > 200:
            raise Denied("Bounded receipt required")
        with self._db() as db:
            row = self._row(db, task_id)
            if row["state"] != "running":
                raise Denied("Task is not running")
            db.execute("UPDATE tasks SET state='completed',receipt=? WHERE id=?", (receipt, task_id))
            self._log(db, task_id, "completed")

    def cancel(self, owner, task_id):
        self._owner(owner)
        with self._db() as db:
            row = self._row(db, task_id)
            if row["state"] not in ("queued", "awaiting_approval"):
                raise Denied("Cannot guarantee cancellation after dispatch")
            db.execute("UPDATE tasks SET state='cancelled',token_hash=NULL,expiry=NULL WHERE id=?", (task_id,))
            self._log(db, task_id, "cancelled")

    def recover_after_worker_stopped(self, owner):
        """Must hold exclusive worker ownership. Unknown outcomes stay blocked."""
        self._owner(owner)
        with self._db() as db:
            ids = [r[0] for r in db.execute("SELECT id FROM tasks WHERE state='running'")]
            for task_id in ids:
                db.execute("UPDATE tasks SET state='unknown' WHERE id=?", (task_id,))
                self._log(db, task_id, "reconciliation_required")
            return ids
