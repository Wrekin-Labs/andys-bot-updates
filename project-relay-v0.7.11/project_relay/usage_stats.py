from __future__ import annotations

import json
import time
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from .owner_full_control import require_enabled
from .state import state_dir

MAX_EVENTS = 10_000


def owner_usage_stats(hours: int = 24, top_actions: int = 20) -> dict[str, Any]:
    require_enabled()
    window = max(1, min(int(hours), 24 * 30))
    top = max(1, min(int(top_actions), 100))
    cutoff = time.time() - window * 3600
    path = state_dir() / "tool-history.jsonl"
    if not path.is_file():
        return {
            "hours": window,
            "calls": 0,
            "successes": 0,
            "failures": 0,
            "success_rate": None,
            "average_duration_ms": None,
            "top_actions": [],
        }
    lines = path.read_text(encoding="utf-8", errors="replace").splitlines()[-MAX_EVENTS:]
    counts: Counter[str] = Counter()
    failures: Counter[str] = Counter()
    duration_sum: defaultdict[str, int] = defaultdict(int)
    duration_count: Counter[str] = Counter()
    total = success = total_duration = timed = 0
    for line in lines:
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(row, dict) or float(row.get("ts") or 0) < cutoff:
            continue
        action = str(row.get("action") or "unknown")
        ok = row.get("success") is True
        duration = max(0, int(row.get("duration_ms") or 0))
        total += 1
        success += int(ok)
        counts[action] += 1
        if not ok:
            failures[action] += 1
        duration_sum[action] += duration
        duration_count[action] += 1
        total_duration += duration
        timed += 1
    rows = []
    for action, count in counts.most_common(top):
        rows.append({
            "action": action,
            "calls": count,
            "failures": failures[action],
            "average_duration_ms": round(duration_sum[action] / max(1, duration_count[action]), 1),
        })
    return {
        "hours": window,
        "calls": total,
        "successes": success,
        "failures": total - success,
        "success_rate": round(success / total, 4) if total else None,
        "average_duration_ms": round(total_duration / timed, 1) if timed else None,
        "top_actions": rows,
        "argument_values_recorded": False,
        "output_values_recorded": False,
    }
