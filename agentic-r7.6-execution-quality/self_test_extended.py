#!/usr/bin/env python3
from correlation_risk_governor import assess
from edge_drift_monitor import monitor

hist={"ADA":[i*.001 for i in range(100)],"SOL":[i*.00105 for i in range(100)],"BTC":[(-1 if i%2 else 1)*.002 for i in range(100)]}
r=assess("ADA",hist,{"SOL":{"entry_cost_gbp":15},"BTC":{"entry_cost_gbp":10}},{"max_pair_correlation":.8,"max_weighted_positive_correlation":.7})
assert not r["allowed"] and r["max_pair_correlation"]>.95,r

stable=[.10+((i%5)-2)*.005 for i in range(160)]
d=monitor(stable,{"baseline_window":100,"recent_window":40,"min_mean_drop":.05})
assert not d["drift"],d
bad=stable[:120]+[-.15+((i%5)-2)*.005 for i in range(40)]
d2=monitor(bad,{"baseline_window":100,"recent_window":40,"min_mean_drop":.05})
assert d2["drift"],d2
print("R7.6 EXTENDED SELF-TEST PASS")
print(r)
print(d2)
