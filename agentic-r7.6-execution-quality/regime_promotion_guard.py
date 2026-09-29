#!/usr/bin/env python3
"""R7.6 regime-conditional forward-performance promotion guard."""
from __future__ import annotations
import math
import statistics

Z90=1.6448536269514722


def _mean_lower(values:list[float], z:float=Z90) -> float:
    if not values:return float("-inf")
    if len(values)==1:return values[0]
    return statistics.mean(values)-z*statistics.stdev(values)/math.sqrt(len(values))


def _wilson_lower(successes:int,n:int,z:float=Z90)->float:
    if n<=0:return 0.0
    p=successes/n;z2=z*z
    center=p+z2/(2*n)
    margin=z*math.sqrt((p*(1-p)+z2/(4*n))/n)
    return max(0.0,(center-margin)/(1+z2/n))


def assess(rows:list[dict], value_field:str="taker_return_pct", config:dict|None=None) -> dict:
    cfg=config or {}
    min_samples=int(cfg.get("min_samples_per_regime",30))
    min_mature=int(cfg.get("min_mature_regimes",2))
    min_mean_lcb=float(cfg.get("min_regime_mean_lcb_pct",-0.02))
    min_pos_lcb=float(cfg.get("min_regime_positive_rate_lcb",0.40))
    buckets={}
    for r in rows:
        regime=str(r.get("regime") or r.get("market_regime") or "UNKNOWN").upper()
        try:v=float(r.get(value_field))
        except Exception:continue
        if not math.isfinite(v):continue
        buckets.setdefault(regime,[]).append(v)

    results=[]; mature=0; failing=[]
    for name,vals in sorted(buckets.items()):
        n=len(vals);mean=statistics.mean(vals);mean_lcb=_mean_lower(vals)
        pos=sum(v>0 for v in vals);pos_lcb=_wilson_lower(pos,n)
        is_mature=n>=min_samples
        passed=(not is_mature) or (mean_lcb>=min_mean_lcb and pos_lcb>=min_pos_lcb)
        if is_mature:
            mature+=1
            if not passed:failing.append(name)
        reasons=[]
        if not is_mature:reasons.append(f"only {n}/{min_samples} samples")
        elif mean_lcb<min_mean_lcb:reasons.append(f"mean LCB {mean_lcb:.4f}% below {min_mean_lcb:.4f}%")
        if is_mature and pos_lcb<min_pos_lcb:reasons.append(f"positive-rate LCB {pos_lcb:.1%} below {min_pos_lcb:.0%}")
        results.append({
            "regime":name,"samples":n,"mature":is_mature,"passed":passed,
            "mean_return_pct":round(mean,6),"mean_lcb90_pct":round(mean_lcb,6),
            "positive_rate":round(pos/n,5),"positive_rate_lcb90":round(pos_lcb,5),
            "reasons":reasons,
        })
    reasons=[]
    if mature<min_mature:reasons.append(f"only {mature}/{min_mature} mature regimes")
    if failing:reasons.append("failing mature regimes: "+", ".join(failing))
    return {
        "state":"PASS" if not reasons else "WARN",
        "promotion_allowed":not reasons,
        "mature_regimes":mature,"required_mature_regimes":min_mature,
        "failing_regimes":failing,"regimes":results,"reasons":reasons,
        "can_change_live":False,
        "policy":"Shadow promotion guard; pooled average cannot override a failing mature regime.",
    }
