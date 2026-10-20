# Offline Jarvis process-recovery demo

Uses the existing task_store.py and Python's standard library. No package
installation, account credentials, external messages or PC control is needed.

Run from this directory with Python 3.10 or later. On Windows, use `py` in
place of `python` if that is your configured Python launcher.

## Normal path

```sh
python demo.py prepare --workspace demo-normal
python demo.py status --workspace demo-normal
python demo.py approve-run --workspace demo-normal
python demo.py status --workspace demo-normal
```

Each command is a separate process. Expected progression: awaiting_approval,
then completed with one fake-provider operation. Repeating approve-run is blocked.

## Crash after a simulated action

```sh
python demo.py prepare --workspace demo-crash
python demo.py crash --workspace demo-crash
python demo.py recover --workspace demo-crash
python demo.py approve-run --workspace demo-crash
python demo.py status --workspace demo-crash
```

The crash step intentionally returns exit code 75. Run subsequent commands
separately; an automation that stops on nonzero exit will stop at that point.

Recovery changes running to unknown. The attempted repeat is blocked, and the
fake-provider operation count remains one. This demonstrates conservative
recovery; it does not establish exactly-once delivery with a real provider.

Each workspace stores a synthetic SQLite task, task identity and fake-provider
log. Use a new directory to start another independent scenario. These files
are unencrypted test data and must not contain real customer information.

`approve-run` is an explicit demo command, not a production owner-authentication
mechanism. No production adapters exist in this prototype.

## Run all checks

```sh
python -m unittest -v test_task_store.py test_demo.py
```

The two new integration checks launch real separate Python processes and
verify both normal completion and recovery after an interrupted simulation.
