#!/usr/bin/env python3
from tail_risk_guard import assess as tail
from regime_promotion_guard import assess as regime
from research_promotion_bundle import assess as bundle

rows=[]
for i in range(240):
    reg="TREND" if i%2 else "RANGE"
    val=0.18 if i%5 else -0.05
    rows.append({
        "taker_return_pct":val,
        "maker_return_pct":val-0.01,
        "maker_filled":"true",
        "regime":reg,
        "route_at_open":"TAKER_NOW",
        "candidate_state":"SHADOW_READY",
    })

t=tail([r["taker_return_pct"] for r in rows],{
    "min_tail_samples":100,"bootstrap_simulations":300,"bootstrap_horizon":80,
    "capital_fraction":0.15,"max_expected_shortfall_loss_pct":2.5,
    "max_bootstrap_p95_drawdown_pct":12,"max_bootstrap_ruin_probability":0.05,
})
assert t["promotion_allowed"],t

g=regime(rows,"taker_return_pct",{
    "min_samples_per_regime":30,"min_mature_regimes":2,
    "min_regime_mean_lcb_pct":-0.02,"min_regime_positive_rate_lcb":0.40,
})
assert g["promotion_allowed"],g

bad=list(rows)
for i in range(60):
    bad.append({"taker_return_pct":-0.8,"maker_return_pct":-0.8,"maker_filled":"true","regime":"CRASH"})
g2=regime(bad,"taker_return_pct",{"min_samples_per_regime":30,"min_mature_regimes":2})
assert not g2["promotion_allowed"] and "CRASH" in g2["failing_regimes"],g2

lab={
 "metrics":{"selection_failure_rate":0.25,"selection_trials_per_fold":6},
 "fold_stats":[
  {"selection_audit":{"trial_count":6,"selected_oos_rank":1,"selected_oos_bottom_half":False}},
  {"selection_audit":{"trial_count":6,"selected_oos_rank":2,"selected_oos_bottom_half":False}},
  {"selection_audit":{"trial_count":6,"selected_oos_rank":2,"selected_oos_bottom_half":False}},
  {"selection_audit":{"trial_count":6,"selected_oos_rank":4,"selected_oos_bottom_half":True}},
 ]
}
config={
 "promotion":{"min_samples":200,"min_regimes":2,"recent_window":40,"max_drawdown_pct":10},
 "selection_bias":{"min_audited_folds":4,"max_selection_failure_rate":0.50},
 "tail_risk":{"min_tail_samples":100,"bootstrap_simulations":300,"bootstrap_horizon":80,"capital_fraction":0.15},
 "regime_promotion":{"min_samples_per_regime":30,"min_mature_regimes":2},
}
b=bundle(rows,"TAKER_NOW","SHADOW_READY",lab,config)
assert b["promotion_ready"],b
print("R7.6 TAIL/REGIME SELF-TEST PASS")
print(t)
print(g)
