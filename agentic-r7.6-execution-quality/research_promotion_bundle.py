#!/usr/bin/env python3
"""Combined R7.6 shadow research promotion bundle.

Every component must pass. This module only reports research readiness; it has
no live execution, sizing, configuration, transfer or arming capability.
"""
from __future__ import annotations
from statistical_promotion_guard import evaluate as statistical_evaluate
from selection_bias_guard import assess as selection_assess
from tail_risk_guard import assess as tail_assess
from regime_promotion_guard import assess as regime_assess


def assess(rows:list[dict], route:str, candidate_state:str, lab_row:dict, config:dict|None=None) -> dict:
    cfg=config or {}
    promo=statistical_evaluate(rows,route,candidate_state,cfg.get("promotion") or cfg)
    selection=selection_assess(lab_row,cfg.get("selection_bias") or {})
    field="maker_return_pct" if route=="MAKER_WAIT" else "taker_return_pct"
    vals=[]
    for r in rows:
        try:vals.append(float(r.get(field)))
        except Exception:pass
    tail=tail_assess(vals,cfg.get("tail_risk") or {})
    regime=regime_assess(rows,field,cfg.get("regime_promotion") or {})
    gates={
        "statistical":bool(promo.get("promotion_ready")),
        "selection_bias":bool(selection.get("promotion_allowed")),
        "tail_risk":bool(tail.get("promotion_allowed")),
        "regime":bool(regime.get("promotion_allowed")),
    }
    reasons=[]
    for name,obj in (
        ("statistical",promo),("selection_bias",selection),("tail_risk",tail),("regime",regime)
    ):
        if not gates[name]:
            reasons.extend(f"{name}: {r}" for r in (obj.get("reasons") or [obj.get("state") or "not passed"]))
    return {
        "shadow_only":True,
        "promotion_ready":all(gates.values()),
        "gates":gates,
        "statistical":promo,
        "selection_bias":selection,
        "tail_risk":tail,
        "regime":regime,
        "reasons":reasons,
        "can_change_live_execution":False,
        "policy":"All research gates must pass; passing is not a guarantee of future profit.",
    }
