# Jarvis 2.0 — offline task recovery prototype

This is a new, isolated Python standard-library prototype. It does not import,
replace, start or connect to any existing Jarvis, Mark-LI, Devlin or Relay app.
No real email, calendar, screen, keyboard, model, trading or deployment adapter
is implemented. `demo.send` is a simulation name only.

## Run the checks

Use Python 3.10 or later in this directory:

```sh
python -m unittest -v test_task_store.py
```

The tests use temporary SQLite databases and a fake external action. They make
no network requests, install no packages and launch no services.

## What this implements

- Persistent, immutable action intents and stable operation keys.
- Duplicate submissions return the existing task; changed intent with the same
  operation key is rejected.
- Exact-intent approvals bind to the store owner, task, destination and payload
  through a digest. Tokens are random, stored as hashes, expire and are consumed
  by an atomic claim transaction. Reissuing approval replaces the old token.
- Cancellation before dispatch invalidates approval.
- Dispatch intent is committed before returning work to the fake adapter.
- Interrupted running tasks become `unknown`, requiring reconciliation. They
  cannot be retried or manually marked complete by this prototype.
- A metadata-only audit trail excludes payloads, tokens and receipt values.

An unknown outcome intentionally blocks progress: this does not promise exactly
once delivery to an external provider. Providers and future adapters must support
idempotency or authoritative reconciliation before real actions are enabled.

## Trust and privacy limits

This is a single-worker local library, not an authenticated service. The owner
argument is only an assertion by trusted Python code. Approval creation and task
completion MUST NOT be exposed directly to an LLM, plugin or unauthenticated HTTP
endpoint. A future owner UI must obtain the owner from a verified session, show
the complete action preview, and keep tokens out of model context.

SQLite stores synthetic intent payloads in plaintext. Use test data only. Audit
redaction is not encryption. File permissions, protected credential storage,
retention, request validation and tamper resistance are not implemented here.

Stop the sole worker before invoking crash recovery. Multi-process workers,
leases, approval revocation during dispatch and cancellation after dispatch need
further design. The two-connection test checks atomic claim exclusion, not a
complete distributed execution system.

## Source review, 20 October 2026

Saved source archives were inspected as text; their installers and desktop
control modules were not run. These are historical snapshots, not proof of the
version currently installed on a workstation.

| Saved package | Confirmed in inspected source | Upgrade implication |
| --- | --- | --- |
| Jarvis Windows Starter 0.2.0 | Tkinter interface, screenshot/text requests, manually reviewed single actions, no persistent task worker | Candidate supervised desktop shell; preserve stop and target checks |
| Jarvis Windows Assistant 0.1.0 | Chat/memory/event tables, action controller and an in-memory confirmation callback | Reuse concepts after review; add durable tasks and approvals rather than migrating blindly |
| Jarvis Mark-LI Safe Windows 0.2 | Native confirmation for enumerated tool/action names; other names return no approval reason | Replace exception-based approval routing with an explicit allowlist; do not assume new tools are safe |
| Mark-LI source snapshot | Dynamic Python plugin import and broad computer-control dispatcher | Treat plugins as executable trusted code; require an adapter boundary before integration |
| Devlin 0.6 | Local SQLite dashboard, manual task states, no AI execution, scheduling, Relay or KeepGoing integration | Useful dashboard concept; its manual approved state is not execution authority |

The Mark-LI archive also contains bundled TLS key material. It was not opened,
imported or published. Do not carry bundled keys into a future build; provision
per-installation credentials if a network service is eventually required.

## Next integration step

Verify the actual installed Windows source and shortcut target read-only when
the target workstation is reachable. Keep that inventory private. Then define a
read-only adapter contract against the verified version and a trusted local
approval UI. No installation, database migration, live test or deployment is
part of this prototype.
