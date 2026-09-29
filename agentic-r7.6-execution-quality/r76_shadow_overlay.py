#!/usr/bin/env python3
"""R7.6 shadow overlay for Andy's Bot.

Combines R7.5 evidence with microstructure quality. Read-only: HTTP GET only,
no order/preview/cancel/approval endpoints.
"""
from __future__ import annotations
import json,time,urllib.request
from pathlib import Path
from microstructure_quality import assess

ROOT=Path(__file__).resolve().parent
R75_CANDIDATES=[
    ROOT.parent/"r7_5_earnings_shadow"/"state"/"r7_5_live_shadow_status.json",
    ROOT.parent/"agentic-r7.5-earnings"/"state"/"r7_5_live_shadow_status.json",
]
R75=next((p for p in R75_CANDIDATES if p.exists()),R75_CANDIDATES[0])
STATUS=ROOT/"state"/"r7_6_shadow_status.json"
URL="http://127.0.0.1:8787/api/live"

DEFAULT={
    "max_book_age_seconds":8.0,"max_spread_bps":25.0,"depth_target_gbp":500.0,
    "min_quality_score":45.0,"max_adverse_selection_risk":65.0,
}

def load(path,default):
    try:return json.loads(path.read_text(encoding="utf-8"))
    except Exception:return default

def save(path,obj):
    path.parent.mkdir(parents=True,exist_ok=True); raw=json.dumps(obj,indent=2)
    try:
        tmp=path.with_suffix(".tmp");tmp.write_text(raw,encoding="utf-8");tmp.replace(path)
    except PermissionError:
        path.write_text(raw,encoding="utf-8");json.loads(path.read_text(encoding="utf-8"))

def live():
    req=urllib.request.Request(URL,headers={"User-Agent":"AndysBot-R76-Shadow"})
    with urllib.request.urlopen(req,timeout=10) as r:return json.load(r)

def once():
    d=live(); r75=load(R75,{}); assets=d.get("assets") or {}; rows=[]
    for old in r75.get("candidates") or []:
        row=dict(old); product=str(row.get("product") or "");sym=product.split("-")[0]
        micro=assess(assets.get(sym) or {},DEFAULT,"BUY")
        row["r76_microstructure"]=micro
        prior=str(row.get("state") or "WATCH")
        ready=prior=="SHADOW_READY" and micro.get("allowed")
        row["r76_state"]="R76_SHADOW_READY" if ready else "WATCH"
        row["r76_reasons"]=list(micro.get("reasons") or [])
        rows.append(row)
    rows.sort(key=lambda x:(x.get("r76_state")=="R76_SHADOW_READY",float((x.get("r76_microstructure") or {}).get("quality_score") or 0)),reverse=True)
    out={
        "schema":"andys-bot-r7.6-shadow-v1","generated_utc":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),
        "mode":"SHADOW_ONLY","rows":rows,"best":rows[0] if rows else None,
        "can_place_orders":False,"can_arm_live":False,"can_change_risk_limits":False,
        "policy":"R7.6 can only add shadow evidence or veto readiness; live engine remains authoritative.",
    }
    save(STATUS,out);return out

def main():
    print("R7.6 MICROSTRUCTURE SHADOW OVERLAY - NO ORDER CAPABILITY",flush=True)
    while True:
        try:
            o=once();b=o.get("best") or {};print(o["generated_utc"],b.get("product"),b.get("r76_state"),flush=True)
        except Exception as e:print("ERROR",repr(e),flush=True)
        time.sleep(5)

if __name__=="__main__":main()
