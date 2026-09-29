#!/usr/bin/env python3
"""Sequential shadow edge-drift monitor using recent-vs-baseline evidence."""
from __future__ import annotations
import math,statistics


def monitor(values:list[float], config:dict|None=None)->dict:
    cfg=config or {}; vals=[float(x) for x in values]
    warm=int(cfg.get("baseline_window",100)); recent_n=int(cfg.get("recent_window",40)); min_n=warm+max(10,recent_n)
    if len(vals)<min_n:
        return {"state":"WARMING","samples":len(vals),"required":min_n,"drift":False,"can_change_live":False}
    baseline=vals[-(warm+recent_n):-recent_n];recent=vals[-recent_n:]
    bm=statistics.mean(baseline);rm=statistics.mean(recent)
    bs=statistics.stdev(baseline) if len(baseline)>1 else 0.0
    rs=statistics.stdev(recent) if len(recent)>1 else 0.0
    se=math.sqrt((bs*bs/max(1,len(baseline)))+(rs*rs/max(1,len(recent))))
    z=(rm-bm)/se if se>1e-12 else (0.0 if rm==bm else (-999.0 if rm<bm else 999.0))
    drop=bm-rm
    z_limit=float(cfg.get("negative_z_limit",-2.0));min_drop=float(cfg.get("min_mean_drop",0.05))
    drift=(z<=z_limit and drop>=min_drop) or (rm<0 and bm>0 and drop>=min_drop)
    state="EDGE_DRIFT" if drift else "STABLE"
    return {"state":state,"drift":drift,"samples":len(vals),"baseline_mean":round(bm,6),"recent_mean":round(rm,6),
            "mean_drop":round(drop,6),"z_score":round(z,4),"baseline_stdev":round(bs,6),"recent_stdev":round(rs,6),
            "can_change_live":False,"policy":"shadow alarm only; live strategy remains authoritative"}
