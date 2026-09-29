#!/usr/bin/env python3
"""Stricter R7.6 statistical promotion guard.

Requires lower confidence bounds, recent stability and drawdown control rather
than promoting from a raw mean/win-rate threshold alone. Shadow-only.
"""
from __future__ import annotations
import math
import statistics
from collections import defaultdict

Z90=1.6448536269514722


def wilson_lower(successes:int,n:int,z:float=Z90)->float:
    if n<=0:return 0.0
    p=successes/n; z2=z*z
    center=p+z2/(2*n)
    margin=z*math.sqrt((p*(1-p)+z2/(4*n))/n)
    return max(0.0,(center-margin)/(1+z2/n))


def mean_lower(values:list[float],z:float=Z90)->float:
    if not values:return float("-inf")
    if len(values)==1:return values[0]
    return statistics.mean(values)-z*statistics.stdev(values)/math.sqrt(len(values))


def max_drawdown_pct(returns_pct:list[float])->float:
    equity=1.0;peak=1.0;worst=0.0
    for r in returns_pct:
        equity*=max(0.000001,1.0+r/100.0)
        peak=max(peak,equity)
        worst=max(worst,(peak-equity)/peak)
    return worst*100.0


def evaluate(rows:list[dict], route:str, state:str, config:dict|None=None)->dict:
    cfg=config or {}
    vals=[];fills=0;regimes=set()
    for r in rows:
        try:vals.append(float(r.get("taker_return_pct") if route!="MAKER_WAIT" else r.get("maker_return_pct")))
        except Exception:continue
        fills+=str(r.get("maker_filled")).lower()=="true"
        reg=str(r.get("regime") or r.get("market_regime") or "UNKNOWN")
        if reg!="UNKNOWN":regimes.add(reg)
    n=len(vals)
    min_samples=int(cfg.get("min_samples",200))
    min_pos_lcb=float(cfg.get("min_positive_rate_lcb",0.50))
    min_mean_lcb=float(cfg.get("min_mean_return_pct_lcb",0.0))
    max_dd=float(cfg.get("max_drawdown_pct",10.0))
    recent_n=min(n,int(cfg.get("recent_window",40)))
    recent=vals[-recent_n:] if recent_n else []
    pos=sum(v>0 for v in vals)
    pos_lcb=wilson_lower(pos,n)
    mean_lcb=mean_lower(vals)
    dd=max_drawdown_pct(vals)
    recent_mean=statistics.mean(recent) if recent else float("-inf")
    min_regimes=int(cfg.get("min_regimes",2))
    reasons=[]
    if state!="SHADOW_READY":reasons.append("observations are not SHADOW_READY")
    if n<min_samples:reasons.append(f"only {n}/{min_samples} observations")
    if pos_lcb<min_pos_lcb:reasons.append(f"positive-rate LCB {pos_lcb:.1%} below {min_pos_lcb:.0%}")
    if mean_lcb<=min_mean_lcb:reasons.append(f"mean-return LCB {mean_lcb:.4f}% is not above {min_mean_lcb:.4f}%")
    if dd>max_dd:reasons.append(f"counterfactual max drawdown {dd:.2f}% above {max_dd:.2f}%")
    if recent_mean<=0:reasons.append(f"recent {recent_n}-sample mean is not positive")
    if len(regimes)<min_regimes:reasons.append(f"only {len(regimes)}/{min_regimes} observed regimes")
    maker_fill_lcb=None
    if route=="MAKER_WAIT":
        maker_fill_lcb=wilson_lower(fills,n)
        req=float(cfg.get("min_maker_fill_rate_lcb",0.10))
        if maker_fill_lcb<req:reasons.append(f"maker-fill LCB {maker_fill_lcb:.1%} below {req:.0%}")
    return {
        "route":route,"candidate_state":state,"samples":n,
        "mean_return_pct":round(statistics.mean(vals),6) if vals else None,
        "mean_return_pct_lcb90":round(mean_lcb,6) if vals else None,
        "positive_rate":round(pos/n,5) if n else 0.0,
        "positive_rate_lcb90":round(pos_lcb,5),
        "counterfactual_max_drawdown_pct":round(dd,5),
        "recent_mean_return_pct":round(recent_mean,6) if recent else None,
        "regime_count":len(regimes),
        "maker_fill_rate_lcb90":round(maker_fill_lcb,5) if maker_fill_lcb is not None else None,
        "promotion_ready":not reasons,"reasons":reasons,
        "can_change_live_execution":False,
    }


def evaluate_all(rows:list[dict],config:dict|None=None)->dict:
    groups=defaultdict(list)
    for r in rows:
        groups[(str(r.get("route_at_open") or "UNKNOWN"),str(r.get("candidate_state") or "UNKNOWN"))].append(r)
    results=[evaluate(v,k[0],k[1],config) for k,v in sorted(groups.items())]
    return {"shadow_only":True,"any_promotion_ready":any(x["promotion_ready"] for x in results),"routes":results}
