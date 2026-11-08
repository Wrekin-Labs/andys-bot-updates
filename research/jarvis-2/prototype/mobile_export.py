"""Export the existing read-only ledger for Jarvis Android. No network access."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
from status_export import read_snapshot, demo_snapshot, STATES


def mobile_snapshot(snapshot, *, sample=False):
    tasks = snapshot['tasks']
    if len(tasks) > 500:
        raise ValueError('Mobile snapshot supports up to 500 tasks')
    safe = []
    for row in tasks:
        task_id, state = row['id'], row['state']
        if not isinstance(task_id, str) or not 0 < len(task_id) <= 100 or state not in STATES:
            raise ValueError('Invalid task identity or state')
        safe.append({'id': task_id, 'state': state})
    return {'schema_version': 1, 'generated_at': datetime.now(timezone.utc).isoformat(),
            'sample': bool(sample), 'tasks': safe}


def write_snapshot(path, snapshot, *, sample=False):
    content = json.dumps(mobile_snapshot(snapshot, sample=sample), ensure_ascii=False)
    if len(content.encode('utf-8')) > 262144:
        raise ValueError('Mobile snapshot exceeds 256 KB')
    with Path(path).open('x', encoding='utf-8') as output:
        output.write(content)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument('--demo', action='store_true')
    source.add_argument('--database', type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    write_snapshot(args.output, demo_snapshot() if args.demo else read_snapshot(args.database), sample=args.demo)


if __name__ == '__main__':
    main()
