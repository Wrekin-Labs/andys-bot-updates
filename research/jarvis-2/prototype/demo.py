"""Run a synthetic Jarvis task across separate processes; no external adapters."""
import argparse
import json
import os
from pathlib import Path

from task_store import Denied, TaskStore

OWNER = 'demo-owner'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('step', choices=['prepare', 'approve-run', 'crash', 'recover', 'status'])
    parser.add_argument('--workspace', type=Path, required=True,
                        help='Separate demo directory; use synthetic data only')
    args = parser.parse_args()
    root = args.workspace.resolve()
    root.mkdir(parents=True, exist_ok=True)
    store = TaskStore(root / 'demo.sqlite3', OWNER)
    manifest = root / 'task-id.txt'
    if args.step == 'prepare':
        tid = store.create(OWNER, 'demo.send', 'fake:demo-inbox',
                           {'text': 'Synthetic Jarvis test message; never sent anywhere.'},
                           'demo-message-v1')
        if not manifest.exists():
            with manifest.open('x', encoding='utf-8') as handle:
                handle.write(tid)
    elif not manifest.exists():
        parser.error('Run prepare first in this workspace')
    else:
        tid = manifest.read_text(encoding='utf-8').strip()

    if args.step in ('approve-run', 'crash'):
        task = store.get(OWNER, tid)
        # Launching this explicit command is the demo's human decision.
        # This is NOT an authenticated production approval interface.
        token = store.approve(OWNER, tid, task['digest'])
        job = store.claim(OWNER, tid, token)
        # A file stands in for a fake provider's durable operation receipt.
        # No message, phone call or network request occurs.
        with (root / 'fake-provider.jsonl').open('a', encoding='utf-8') as handle:
            handle.write(json.dumps({'operation_key': job['operation_key']}) + '\n')
            handle.flush()
            os.fsync(handle.fileno())
        if args.step == 'crash':
            print(json.dumps({'state': 'running', 'simulated_crash': True}), flush=True)
            return 75  # persisted dispatch; deliberately no local completion receipt
        store.complete(OWNER, tid, 'fake:demo-receipt')
    elif args.step == 'recover':
        store.recover_after_worker_stopped(OWNER)

    provider = root / 'fake-provider.jsonl'
    count = len(provider.read_text(encoding='utf-8').splitlines()) if provider.exists() else 0
    print(json.dumps({'state': store.get(OWNER, tid)['state'],
                      'fake_provider_operations': count, 'simulation_only': True}))
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Denied as error:
        print(json.dumps({'blocked': str(error), 'simulation_only': True}))
        raise SystemExit(2)
