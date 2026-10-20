"""Read a demo ledger without changing it and export a standalone HTML snapshot."""
import argparse
from collections import Counter
from datetime import datetime, timezone
import html
from pathlib import Path
import sqlite3
import tempfile


STATES = {'awaiting_approval': 'Waiting for approval', 'queued': 'Queued',
          'running': 'Running', 'completed': 'Completed', 'cancelled': 'Cancelled',
          'unknown': 'Needs reconciliation'}


def read_snapshot(database):
    path = Path(database).resolve()
    # mode=ro refuses a missing database; never creates or migrates one.
    db = sqlite3.connect(path.as_uri() + '?mode=ro', uri=True)
    try:
        db.execute('PRAGMA query_only=ON')
        rows = db.execute('SELECT id,state FROM tasks ORDER BY rowid DESC').fetchall()
        counts = Counter(state if state in STATES else 'unknown' for _, state in rows)
        return {'tasks': [{'id': str(tid), 'state': state if state in STATES else 'unknown'}
                          for tid, state in rows], 'counts': dict(counts)}
    finally:
        db.close()


def render(snapshot, *, sample=False):
    tasks, counts = snapshot['tasks'], snapshot['counts']
    cards = ''.join(
        f'<button class="metric" data-filter="{state}" aria-pressed="false">'
        f'<span>{label}</span><strong>{counts.get(state, 0)}</strong></button>'
        for state, label in STATES.items())
    rows = ''.join(
        f'<tr data-state="{t["state"]}"><td><code>{html.escape(t["id"])}</code></td>'
        f'<td><span class="badge {t["state"]}">{STATES[t["state"]]}</span></td>'
        f'<td>{"Check the provider receipt before any retry" if t["state"] == "unknown" else "Status recorded in the demo ledger"}</td></tr>'
        for t in tasks)
    stamp = datetime.now(timezone.utc).strftime('%d %B %Y, %H:%M UTC')
    banner = 'SYNTHETIC DEMO' if sample else 'OFFLINE LEDGER SNAPSHOT'
    return '''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; base-uri 'none'; form-action 'none'">
<title>Jarvis • Task status</title><style>
:root{font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#dfe9f2;background:#0b1119;color-scheme:dark}
*{box-sizing:border-box}body{margin:0}main{max-width:1120px;margin:auto;padding:48px 24px}
.eyebrow{font-size:12px;letter-spacing:.16em;color:#7ddfc9;font-weight:700}h1{font-size:clamp(34px,6vw,58px);letter-spacing:-.04em;margin:12px 0}
.intro{max-width:700px;color:#aab9c9;line-height:1.6}header{display:flex;justify-content:space-between;gap:24px;align-items:start}
.mode{border:1px solid #354353;border-radius:24px;padding:9px 13px;font-size:11px;letter-spacing:.08em;white-space:nowrap}
.metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:32px 0}
button{font:inherit;cursor:pointer;color:inherit}button:focus-visible{outline:3px solid #7ddfc9;outline-offset:3px}
.metric{text-align:left;background:#121e2b;border:1px solid #273647;border-radius:14px;padding:20px}
.metric span{display:block;color:#aab9c9;font-size:13px}.metric strong{display:block;margin-top:9px;font-size:32px;font-weight:600}
.metric[aria-pressed=true]{border-color:#7ddfc9;background:#18343a}.toolbar{display:flex;gap:16px;justify-content:space-between;align-items:center;margin:30px 0 16px}
h2{font-size:20px;margin:0}.all{background:transparent;border:1px solid #354353;border-radius:8px;padding:8px 12px}
.table-wrap{overflow:auto;border:1px solid #273647;border-radius:14px}table{width:100%;border-collapse:collapse;min-width:650px;text-align:left}
th{padding:16px;color:#94a7ba;font-size:12px;font-weight:500;background:#121e2b}td{padding:18px 16px;border-top:1px solid #273647;font-size:13px}
code{font-size:11px;color:#bccbd9}.badge{display:inline-block;padding:6px 9px;border-radius:6px;white-space:nowrap;background:#273647}
.completed{background:#193c35;color:#9ae9cd}.awaiting_approval{background:#463a21;color:#f6d58b}.unknown{background:#452c36;color:#ffb6c8}.cancelled{background:#28313e;color:#b2bfce}
.note{padding:20px;border-left:3px solid #7ddfc9;background:#111d29;margin-top:24px;line-height:1.7;color:#aab9c9;font-size:13px}
footer{font-size:12px;color:#8194a7;margin-top:24px;line-height:1.7}#empty{padding:18px;color:#aab9c9}
@media(max-width:650px){main{padding:28px 16px}header{display:block}.mode{display:inline-block;margin-top:16px}.metrics{grid-template-columns:repeat(2,1fr)}.metric{padding:16px}}
</style></head><body><main><header><div><div class="eyebrow">JARVIS / RESEARCH PROTOTYPE</div>
<h1>Every task, accounted for.</h1><p class="intro">See what is waiting, what finished and what needs a closer look. Select a status to filter the task list.</p>
</div><span class="mode">''' + banner + '''</span></header>
<section class="metrics" aria-label="Filter tasks by status">''' + cards + '''</section>
<div class="toolbar"><h2>Task ledger</h2><button class="all" id="show-all">Show all tasks</button></div>
<div class="table-wrap"><table><thead><tr><th>Task identity</th><th>Status</th><th>Next step</th></tr></thead><tbody>''' + rows + '''</tbody></table>
<div id="empty" hidden>No tasks match this status.</div></div>
<div class="note"><strong>Read-only snapshot.</strong> This page cannot approve or execute a task. “Needs reconciliation” means an interrupted operation has an uncertain outcome: check its receipt before considering a retry. All actions in this prototype are simulated.</div>
<footer>Generated ''' + stamp + '''. This page does not refresh automatically. It contains task identities and status only; no message bodies, credentials, approval tokens or receipts are exported.</footer>
</main><script>
const rows=[...document.querySelectorAll('tbody tr')];
const buttons=[...document.querySelectorAll('[data-filter]')];
function filter(state){let count=0;for(const row of rows){row.hidden=!!state&&row.dataset.state!==state;if(!row.hidden)count++;}
for(const b of buttons)b.setAttribute('aria-pressed',String(b.dataset.filter===state));document.getElementById('empty').hidden=count>0;}
for(const button of buttons)button.addEventListener('click',()=>filter(button.dataset.filter));
document.getElementById('show-all').addEventListener('click',()=>filter(''));filter('');
</script></body></html>'''


def demo_snapshot():
    from task_store import TaskStore
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / 'demo.sqlite3'
        store = TaskStore(path, 'demo-owner')
        for key, state in [('waiting', 'awaiting_approval'), ('done', 'completed'),
                           ('cancelled', 'cancelled'), ('interrupted', 'unknown')]:
            tid = store.create('demo-owner', 'demo.send', 'fake:inbox', {'text': 'Synthetic'}, key)
            if state == 'cancelled':
                store.cancel('demo-owner', tid)
            elif state in ('completed', 'unknown'):
                token = store.approve('demo-owner', tid, store.get('demo-owner', tid)['digest'])
                store.claim('demo-owner', tid, token)
                if state == 'completed':
                    store.complete('demo-owner', tid, 'fake:receipt')
        store.recover_after_worker_stopped('demo-owner')
        return read_snapshot(path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sources = parser.add_mutually_exclusive_group(required=True)
    sources.add_argument('--demo', action='store_true')
    sources.add_argument('--database', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    snapshot = demo_snapshot() if args.demo else read_snapshot(args.database)
    # Refuse an existing output file instead of overwriting user work.
    with args.output.open('x', encoding='utf-8') as output:
        output.write(render(snapshot, sample=args.demo))
    print(f'Created {args.output.name}: {len(snapshot["tasks"])} synthetic-ledger tasks')


if __name__ == '__main__':
    main()
