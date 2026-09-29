#!/usr/bin/env python3
"""Read-only R7.6 live transaction-cost/markout recorder.

Reads only Andy's Bot local /api/live. It never calls order, approval, cancel,
edit, transfer or configuration endpoints.
"""
from __future__ import annotations
import json,time,urllib.request
from pathlib import Path
from execution_tca import implementation_shortfall_bps,entry_cost_bps,markout_bps

ROOT=Path(__file__).resolve().parent
STATE=ROOT/"state"/"live_tca_state.json";LOG=ROOT/"state"/"live_tca.jsonl";STATUS=ROOT/"state"/"live_tca_status.json"
URL="http://127.0.0.1:8787/api/live";HORIZONS=(60,300,900,3600)

def load(p,d):
    try:return json.loads(p.read_text(encoding="utf-8"))
    except Exception:return d

def save(p,o):
    p.parent.mkdir(parents=True,exist_ok=True);raw=json.dumps(o,indent=2)
    try:
        t=p.with_suffix(".tmp");t.write_text(raw,encoding="utf-8");t.replace(p)
    except PermissionError:p.write_text(raw,encoding="utf-8")

def live():
    req=urllib.request.Request(URL,headers={"User-Agent":"AndysBot-R76-TCA"})
    with urllib.request.urlopen(req,timeout=8) as r:return json.load(r)

def mid_for(d,sym):
    a=(d.get("assets") or {}).get(sym) or {};b=a.get("coinbase_orderbook") or {}
    bid=float(b.get("best_bid") or 0);ask=float(b.get("best_ask") or 0)
    return (bid+ask)/2 if bid>0 and ask>bid else None

def fee_rate(d):
    f=d.get("fee_profile") or {};return float(f.get("taker_fee") or 0.0)

def emit(row):
    LOG.parent.mkdir(parents=True,exist_ok=True)
    with LOG.open("a",encoding="utf-8") as f:f.write(json.dumps(row,separators=(",",":"))+"\n")

def once():
    d=live();lc=d.get("live_canary") or {};now=time.time();st=load(STATE,{"episodes":{},"completed":0});eps=st.setdefault("episodes",{})
    active=set()
    for sym,pos in (lc.get("positions") or {}).items():
        oid=str((pos or {}).get("order_id") or "")
        if not oid:continue
        active.add(oid);entry=float((pos or {}).get("entry_price") or 0);m=mid_for(d,sym)
        if oid not in eps and entry>0 and m:
            fee=fee_rate(d);eps[oid]={"symbol":sym,"product":str((pos or {}).get("product_id") or f"{sym}-GBP"),"entry_price":entry,
                "first_seen":now,"reference_mid":m,"fee_rate":fee,"marks":{},
                "implementation_shortfall_bps":implementation_shortfall_bps("BUY",m,entry),"entry_cost_bps":entry_cost_bps("BUY",m,entry,fee)}
            emit({"event":"ENTRY_OBSERVED","utc":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime(now)),"order_id":oid,**eps[oid]})
    for oid,e in list(eps.items()):
        m=mid_for(d,e["symbol"]);age=now-float(e["first_seen"])
        if m:
            for h in HORIZONS:
                key=str(h)
                if age>=h and key not in e["marks"]:
                    val=markout_bps("BUY",float(e["entry_price"]),m);e["marks"][key]=val
                    emit({"event":"MARKOUT","utc":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime(now)),"order_id":oid,"symbol":e["symbol"],"horizon_seconds":h,"markout_bps":val})
        if oid not in active and age>=60:
            emit({"event":"POSITION_NO_LONGER_OPEN","utc":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime(now)),"order_id":oid,"symbol":e["symbol"],"marks":e["marks"]})
            st["completed"]=int(st.get("completed",0))+1;eps.pop(oid,None)
    save(STATE,st)
    out={"schema":"andys-bot-r7.6-live-tca-v1","generated_utc":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime(now)),
         "read_only":True,"can_place_orders":False,"open_episodes":len(eps),"completed":int(st.get("completed",0)),"horizons_seconds":list(HORIZONS)}
    save(STATUS,out);return out

def main():
    print("R7.6 LIVE TCA - READ ONLY",flush=True)
    while True:
        try:print(once(),flush=True)
        except Exception as e:print("ERROR",repr(e),flush=True)
        time.sleep(5)

if __name__=="__main__":main()
