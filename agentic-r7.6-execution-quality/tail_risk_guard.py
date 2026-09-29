#!/usr/bin/env python3
"""R7.6 shadow-only tail-risk robustness diagnostics.

The inputs are completed forward/shadow trade returns in percentage points.
Bootstrap portfolio paths scale each trade by a configurable capital fraction,
so this is a comparative research diagnostic rather than a prediction of
account loss. It cannot change live sizing or execution.
"""
from __future__ import annotations
import math
import random
import statistics


def _f(v, d=0.0):
    try:
        x=float(v)
        return x if math.isfinite(x) else d
    except Exception:
        return d


def _quantile(values:list[float], q:float) -> float | None:
    if not values:
        return None
    x=sorted(float(v) for v in values)
    if len(x)==1:
        return x[0]
    q=max(0.0,min(1.0,float(q)))
    pos=q*(len(x)-1)
    lo=int(math.floor(pos)); hi=int(math.ceil(pos))
    if lo==hi:
        return x[lo]
    w=pos-lo
    return x[lo]*(1-w)+x[hi]*w


def expected_shortfall_pct(values:list[float], alpha:float=0.05) -> float | None:
    if not values:
        return None
    x=sorted(float(v) for v in values)
    k=max(1,int(math.ceil(len(x)*max(0.001,min(0.5,alpha)))))
    return statistics.mean(x[:k])


def max_drawdown_pct(returns_pct:list[float], capital_fraction:float=1.0) -> float:
    equity=1.0; peak=1.0; worst=0.0
    f=max(0.0,min(1.0,float(capital_fraction)))
    for r in returns_pct:
        step=1.0+f*float(r)/100.0
        equity*=max(1e-9,step)
        peak=max(peak,equity)
        worst=max(worst,(peak-equity)/peak)
    return worst*100.0


def longest_loss_streak(values:list[float]) -> int:
    best=cur=0
    for v in values:
        if float(v)<0:
            cur+=1;best=max(best,cur)
        else:
            cur=0
    return best


def _block_bootstrap(values:list[float], horizon:int, block_size:int, rng:random.Random) -> list[float]:
    n=len(values); out=[]
    if n==0 or horizon<=0:
        return out
    b=max(1,min(int(block_size),n))
    while len(out)<horizon:
        start=rng.randrange(0,n)
        for j in range(b):
            out.append(float(values[(start+j)%n]))
            if len(out)>=horizon:
                break
    return out


def assess(values:list[float], config:dict|None=None) -> dict:
    cfg=config or {}
    vals=[float(v) for v in values if math.isfinite(float(v))]
    min_samples=int(cfg.get("min_tail_samples",100))
    if len(vals)<min_samples:
        return {
            "state":"WARMING","promotion_allowed":False,"samples":len(vals),
            "required_samples":min_samples,"can_change_live":False,
            "reasons":[f"only {len(vals)}/{min_samples} completed forward outcomes"],
        }

    alpha=float(cfg.get("expected_shortfall_alpha",0.05))
    es=expected_shortfall_pct(vals,alpha)
    q05=_quantile(vals,alpha)
    frac=max(0.01,min(1.0,float(cfg.get("capital_fraction",0.15))))
    sims=max(100,min(10000,int(cfg.get("bootstrap_simulations",2000))))
    horizon=max(20,min(1000,int(cfg.get("bootstrap_horizon",min(100,len(vals))))))
    block=max(1,min(50,int(cfg.get("bootstrap_block_size",5))))
    ruin_floor=max(0.01,min(0.99,float(cfg.get("ruin_floor_fraction",0.85))))
    rng=random.Random(int(cfg.get("bootstrap_seed",760)))

    dds=[]; streaks=[]; ruins=0
    for _ in range(sims):
        path=_block_bootstrap(vals,horizon,block,rng)
        dds.append(max_drawdown_pct(path,frac))
        streaks.append(longest_loss_streak(path))
        equity=1.0
        ruined=False
        for r in path:
            equity*=max(1e-9,1.0+frac*r/100.0)
            if equity<=ruin_floor:
                ruined=True;break
        ruins+=int(ruined)

    p95_dd=_quantile(dds,0.95) or 0.0
    p95_streak=_quantile(streaks,0.95) or 0.0
    ruin_prob=ruins/sims
    es_limit=abs(float(cfg.get("max_expected_shortfall_loss_pct",2.5)))
    dd_limit=float(cfg.get("max_bootstrap_p95_drawdown_pct",12.0))
    ruin_limit=float(cfg.get("max_bootstrap_ruin_probability",0.05))
    reasons=[]
    if es is not None and es < -es_limit:
        reasons.append(f"{alpha:.0%} expected shortfall {es:.3f}% worse than -{es_limit:.3f}%")
    if p95_dd>dd_limit:
        reasons.append(f"bootstrap p95 drawdown {p95_dd:.2f}% above {dd_limit:.2f}%")
    if ruin_prob>ruin_limit:
        reasons.append(f"bootstrap ruin probability {ruin_prob:.1%} above {ruin_limit:.1%}")

    return {
        "state":"PASS" if not reasons else "WARN",
        "promotion_allowed":not reasons,
        "samples":len(vals),
        "mean_return_pct":round(statistics.mean(vals),6),
        "expected_shortfall_alpha":alpha,
        "expected_shortfall_pct":round(es,6) if es is not None else None,
        "quantile_pct":round(q05,6) if q05 is not None else None,
        "capital_fraction":frac,
        "bootstrap_simulations":sims,
        "bootstrap_horizon":horizon,
        "bootstrap_block_size":block,
        "bootstrap_p95_drawdown_pct":round(p95_dd,6),
        "bootstrap_p95_loss_streak":round(p95_streak,3),
        "bootstrap_ruin_probability":round(ruin_prob,6),
        "reasons":reasons,
        "can_change_live":False,
        "policy":"Shadow robustness diagnostic only; not a forecast or live risk control.",
    }
