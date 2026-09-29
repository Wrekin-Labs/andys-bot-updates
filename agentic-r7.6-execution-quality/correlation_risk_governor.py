#!/usr/bin/env python3
"""Shadow-only correlation-aware portfolio risk governor for R7.6."""
from __future__ import annotations
import math
import statistics


def pearson(a:list[float], b:list[float]) -> float | None:
    n=min(len(a),len(b))
    if n<10:return None
    x=list(map(float,a[-n:]));y=list(map(float,b[-n:]))
    mx=statistics.mean(x);my=statistics.mean(y)
    sx=sum((v-mx)**2 for v in x);sy=sum((v-my)**2 for v in y)
    if sx<=0 or sy<=0:return None
    return max(-1.0,min(1.0,sum((x[i]-mx)*(y[i]-my) for i in range(n))/math.sqrt(sx*sy)))


def assess(candidate:str, history:dict[str,list[float]], open_positions:dict, config:dict|None=None)->dict:
    cfg=config or {}; base=history.get(candidate) or []
    rows=[]; weighted=0.0;weight_sum=0.0;max_corr=0.0
    for sym,pos in (open_positions or {}).items():
        if sym==candidate:continue
        c=pearson(base,history.get(sym) or [])
        if c is None:continue
        exposure=float((pos or {}).get("entry_cost_gbp") or (pos or {}).get("exposure_gbp") or 0.0)
        w=max(1.0,exposure)
        weighted+=max(0.0,c)*w;weight_sum+=w;max_corr=max(max_corr,c)
        rows.append({"symbol":sym,"correlation":round(c,4),"exposure_gbp":round(exposure,2)})
    avg=weighted/weight_sum if weight_sum else 0.0
    max_allowed=float(cfg.get("max_pair_correlation",0.80));avg_allowed=float(cfg.get("max_weighted_positive_correlation",0.70))
    reasons=[]
    if max_corr>max_allowed:reasons.append(f"max pair correlation {max_corr:.2f} above {max_allowed:.2f}")
    if avg>avg_allowed:reasons.append(f"weighted positive correlation {avg:.2f} above {avg_allowed:.2f}")
    return {"candidate":candidate,"allowed":not reasons,"max_pair_correlation":round(max_corr,4),
            "weighted_positive_correlation":round(avg,4),"comparisons":rows,"reasons":reasons,
            "can_change_live_positions":False,"policy":"shadow-only diversification evidence"}
