#!/usr/bin/env python3
"""Shadow-only selection-bias guard for R7.6.

Consumes R7.4/R7.5 walk-forward metadata. It never changes strategy choice or
live execution. It blocks research promotion when the in-sample winner often
lands in the bottom half out-of-sample or when selection metadata is missing.
"""
from __future__ import annotations
import math


def num(v, d=0.0):
    try:
        x=float(v)
        return x if math.isfinite(x) else d
    except Exception:
        return d


def assess(lab_row: dict, config: dict | None = None) -> dict:
    cfg=config or {}
    m=(lab_row or {}).get("metrics") or {}
    folds=(lab_row or {}).get("fold_stats") or []
    min_folds=int(cfg.get("min_audited_folds",4))
    max_failure=float(cfg.get("max_selection_failure_rate",0.50))
    max_trials=int(cfg.get("max_untracked_trials",12))
    failures=[]
    audited=0
    trial_counts=[]
    ranks=[]
    for f in folds:
        a=(f or {}).get("selection_audit") or {}
        n=int(a.get("trial_count") or 0)
        rank=int(a.get("selected_oos_rank") or 0)
        if n>0 and rank>0:
            audited+=1
            trial_counts.append(n)
            ranks.append(rank)
            failures.append(bool(a.get("selected_oos_bottom_half")))
    recorded_rate=m.get("selection_failure_rate")
    rate=(sum(failures)/audited) if audited else (num(recorded_rate,-1.0) if recorded_rate is not None else -1.0)
    trials=max(trial_counts) if trial_counts else int(m.get("selection_trials_per_fold") or 0)
    reasons=[]
    if audited<min_folds:
        reasons.append(f"only {audited}/{min_folds} folds have candidate-level selection audit")
    if rate < 0:
        reasons.append("selection-failure rate unavailable")
    elif rate > max_failure:
        reasons.append(f"in-sample winner bottom-half OOS rate {rate:.0%} exceeds {max_failure:.0%}")
    if trials<=0:
        reasons.append("number of tried parameter variants is unavailable")
    elif trials>max_trials and audited<min_folds:
        reasons.append(f"{trials} variants tried without enough OOS rank audit")
    return {
        "state":"PASS" if not reasons else "WARN",
        "promotion_allowed":not reasons,
        "audited_folds":audited,
        "selection_trials_per_fold":trials or None,
        "selection_failure_rate":round(rate,4) if rate>=0 else None,
        "selected_oos_ranks":ranks,
        "reasons":reasons,
        "can_change_live_execution":False,
        "policy":"Research-promotion guard only; never alters live trading.",
    }
