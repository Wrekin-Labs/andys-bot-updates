# Read-only task dashboard

Export a standalone browser page from the synthetic demo ledger. No server,
network connection or additional package is required. Use Python 3.10+.

```sh
python status_export.py --demo --output jarvis-status.html
```

Open the HTML file in a browser. Select a status card to filter the task list.
The demo contains one task each awaiting approval, completed, cancelled and
needing reconciliation. These are synthetic states, not real account activity.

To inspect a ledger created by demo.py:

```sh
python status_export.py --database demo-normal/demo.sqlite3 --output status-normal.html
```

The SQLite connection uses mode=ro and query_only. It cannot create a missing
database or migrate an existing one. Output contains only task identities and
normalised statuses; no task payloads, destinations, operation keys, approval
tokens or receipts. Existing HTML output files are not overwritten.

This is a snapshot, not a live monitor. Export a new filename for an updated
view. There are no approve, execute, retry or PC-control buttons.

This exporter is designed for the prototype's synthetic ledgers. It has no
authentication or tenant filtering; do not point it at a shared production
database. Do not publish private exported task identities to a public site.

Run the checks:

```sh
python -m unittest -v test_task_store.py test_demo.py test_status_export.py
```

Validation covers database byte preservation, refusal to create missing
databases, omission of private fields, escaped identities and expected demo
states. A static HTML check excludes external resources and forms. Browser
layout and interaction checks remain separate.
