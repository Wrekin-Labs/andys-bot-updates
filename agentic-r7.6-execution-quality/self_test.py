#!/usr/bin/env python3
import math
from microstructure_quality import assess
from queue_fill_model import QueueFillTracker, walk_buy_quote
from execution_tca import implementation_shortfall_bps, entry_cost_bps, markout_bps, summarize
from statistical_promotion_guard import evaluate, wilson_lower

cfg={"max_book_age_seconds":8,"max_spread_bps":25,"depth_target_gbp":500,"min_quality_score":45,"max_adverse_selection_risk":65}
asset={
 "coinbase_orderbook":{"best_bid":100,"best_ask":100.10,"best_bid_size":12,"best_ask_size":4,"bid_depth_5_gbp":1500,"ask_depth_5_gbp":1000,"age_seconds":1},
 "order_flow":{"trade_pressure_score":40},
}
a=assess(asset,cfg)
assert a["ok"] and a["allowed"],a
assert a["directional_score"]>0,a
assert a["microprice"]>a["mid"],a

wide={"coinbase_orderbook":{"best_bid":100,"best_ask":101,"bid_depth_5_gbp":50,"ask_depth_5_gbp":50,"age_seconds":20}}
b=assess(wide,cfg)
assert not b["allowed"] and b["adverse_selection_risk"]>65,b

q=QueueFillTracker("BUY",100,50,100)
assert q.on_trade(100,80,"SELL")==0
assert q.qty_ahead==20
assert q.on_trade(100,30,"SELL")==10
assert q.filled_qty==10
q.on_trade(100,40,"SELL")
assert q.done

walk=walk_buy_quote(150,[(100,1),(101,1)])
assert walk["filled"] and math.isclose(walk["quote_spent"],150,rel_tol=1e-9)
assert walk["slippage_bps"]>0

assert implementation_shortfall_bps("BUY",100,100.05)>0
assert entry_cost_bps("BUY",100,100.05,.001)>implementation_shortfall_bps("BUY",100,100.05)
assert markout_bps("BUY",100,101)>0
s=summarize([{"route":"TAKER_NOW","product":"BTC-GBP","net_return_pct":.1},{"route":"TAKER_NOW","product":"BTC-GBP","net_return_pct":.2}])
assert s["groups"][0]["samples"]==2

rows=[]
for i in range(240):
    rows.append({"taker_return_pct":0.18 if i%5 else -0.05,"maker_return_pct":0.16 if i%5 else -0.05,"maker_filled":"true","regime":"TREND" if i%2 else "RANGE"})
p=evaluate(rows,"TAKER_NOW","SHADOW_READY",{"min_samples":200,"min_regimes":2,"recent_window":40,"max_drawdown_pct":10})
assert p["promotion_ready"],p
p2=evaluate(rows[:50],"TAKER_NOW","SHADOW_READY",{"min_samples":200,"min_regimes":2})
assert not p2["promotion_ready"]
assert 0<wilson_lower(60,100)<.60
print("R7.6 SELF-TEST PASS")
print("microstructure",a)
print("promotion",p)
