#!/usr/bin/env python3
from selection_bias_guard import assess

good={
  "metrics":{"selection_failure_rate":0.25,"selection_trials_per_fold":6},
  "fold_stats":[
    {"selection_audit":{"trial_count":6,"selected_oos_rank":1,"selected_oos_bottom_half":False}},
    {"selection_audit":{"trial_count":6,"selected_oos_rank":2,"selected_oos_bottom_half":False}},
    {"selection_audit":{"trial_count":6,"selected_oos_rank":2,"selected_oos_bottom_half":False}},
    {"selection_audit":{"trial_count":6,"selected_oos_rank":4,"selected_oos_bottom_half":True}}
  ]
}
bad={
  "metrics":{"selection_failure_rate":0.75,"selection_trials_per_fold":6},
  "fold_stats":[
    {"selection_audit":{"trial_count":6,"selected_oos_rank":5,"selected_oos_bottom_half":True}},
    {"selection_audit":{"trial_count":6,"selected_oos_rank":6,"selected_oos_bottom_half":True}},
    {"selection_audit":{"trial_count":6,"selected_oos_rank":4,"selected_oos_bottom_half":True}},
    {"selection_audit":{"trial_count":6,"selected_oos_rank":1,"selected_oos_bottom_half":False}}
  ]
}
missing={"metrics":{},"fold_stats":[{},{}]}

g=assess(good); b=assess(bad); m=assess(missing)
assert g["promotion_allowed"],g
assert not b["promotion_allowed"],b
assert not m["promotion_allowed"],m
print("R7.6 SELECTION-BIAS SELF-TEST PASS")
print(g)
print(b)
