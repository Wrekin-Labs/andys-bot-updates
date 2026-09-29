#!/usr/bin/env python3
"""Transaction-cost and markout analytics for live/shadow fills."""
from __future__ import annotations
import math
import statistics
from collections import defaultdict
from typing import Iterable


def _f(v, d=0.0):
    try:
        x=float(v); return x if math.isfinite(x) else d
    except Exception:return d


def implementation_shortfall_bps(side: str, reference_mid: float, fill_price: float) -> float:
    if reference_mid <= 0 or fill_price <= 0:
        return 0.0
    raw=(fill_price/reference_mid-1.0)*10_000.0
    return raw if side.upper()=="BUY" else -raw


def entry_cost_bps(side: str, reference_mid: float, fill_price: float, fee_rate: float) -> float:
    return implementation_shortfall_bps(side, reference_mid, fill_price) + max(0.0, fee_rate)*10_000.0


def markout_bps(side: str, fill_price: float, future_mid: float) -> float:
    if fill_price <= 0 or future_mid <= 0:
        return 0.0
    raw=(future_mid/fill_price-1.0)*10_000.0
    return raw if side.upper()=="BUY" else -raw


def summarize(records: Iterable[dict], value_field: str="net_return_pct", group_fields=("route","product")) -> dict:
    groups=defaultdict(list)
    for r in records:
        try:v=float(r.get(value_field))
        except Exception:continue
        key=tuple(str(r.get(k) or "UNKNOWN") for k in group_fields)
        groups[key].append(v)
    out=[]
    for key, vals in sorted(groups.items()):
        vals=sorted(vals);n=len(vals)
        mean=statistics.mean(vals);med=statistics.median(vals)
        sd=statistics.stdev(vals) if n>1 else 0.0
        p10=vals[max(0,int((n-1)*0.10))];p90=vals[min(n-1,int((n-1)*0.90))]
        out.append({
            **{group_fields[i]:key[i] for i in range(len(group_fields))},
            "samples":n,"mean":round(mean,6),"median":round(med,6),
            "stdev":round(sd,6),"positive_rate":round(sum(v>0 for v in vals)/n,5),
            "p10":round(p10,6),"p90":round(p90,6),
        })
    return {"groups":out,"value_field":value_field}
