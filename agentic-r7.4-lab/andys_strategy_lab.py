#!/usr/bin/env python3
"""Andy's Bot Strategy Lab R7.4.

Backtest + walk-forward + paper trading. No real orders.
Standard library only, public Coinbase Exchange market data.

Derived from Andrew's Coinbase Strategy Lab v2, hardened for integration with
Andy's Bot. It writes machine-readable validation output that the R7.4
agentic supervisor can consume as an independent evidence source.
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import os
import random
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

API = "https://api.exchange.coinbase.com"
ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
STATE = ROOT / "state"
WARM = 210
MAX_CANDLES_PER_REQUEST = 300
USER_AGENT = "andys-bot-strategy-lab-r74"


def utc_iso(ts: float | int) -> str:
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def atomic_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
    tmp.replace(path)


def http_json(url: str, retries: int = 5):
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=20) as response:
                return json.load(response)
        except Exception as exc:
            last = exc
            if attempt == retries - 1:
                break
            time.sleep(min(12, 1.5 * (attempt + 1) ** 2))
    raise RuntimeError(f"market data request failed: {last}")


def _read_cache(path: Path) -> dict[int, tuple]:
    rows: dict[int, tuple] = {}
    if not path.exists():
        return rows
    try:
        with path.open(newline="", encoding="utf-8") as handle:
            for row in csv.reader(handle):
                if len(row) != 6:
                    continue
                ts = int(row[0])
                rows[ts] = (ts,) + tuple(map(float, row[1:]))
    except Exception:
        return {}
    return rows


def fetch(product: str, granularity: int, days: int) -> list[tuple]:
    """Return closed candles (t, open, high, low, close, volume), oldest first."""
    DATA.mkdir(parents=True, exist_ok=True)
    safe_product = product.replace("/", "-")
    path = DATA / f"{safe_product}_{granularity}.csv"
    rows = _read_cache(path)
    end = int(time.time()) // granularity * granularity
    start = end - int(days * 86400)
    have = sorted(rows)
    ranges = [(start, end)] if not have else []
    if have:
        if start < have[0] - granularity:
            ranges.append((start, have[0]))
        if have[-1] + granularity < end:
            ranges.append((have[-1] + granularity, end))
    for first, last in ranges:
        t = first
        while t < last:
            t2 = min(t + MAX_CANDLES_PER_REQUEST * granularity, last)
            query = urllib.parse.urlencode(
                {"granularity": granularity, "start": utc_iso(t), "end": utc_iso(t2)}
            )
            data = http_json(f"{API}/products/{product}/candles?{query}")
            if isinstance(data, dict) and data.get("message"):
                raise RuntimeError(str(data["message"]))
            for candle in data:
                if not isinstance(candle, list) or len(candle) < 6:
                    continue
                ts, lo, hi, op, cl, vol = candle[:6]
                ts = int(ts)
                if start <= ts < end:
                    rows[ts] = (ts, float(op), float(hi), float(lo), float(cl), float(vol))
            t = t2
            time.sleep(0.30)
    ordered = [rows[k] for k in sorted(rows) if start <= k < end]
    with path.open("w", newline="", encoding="utf-8") as handle:
        csv.writer(handle).writerows(rows[k] for k in sorted(rows))
    return ordered


def synthetic(n: int = 6000, granularity: int = 21600, seed: int = 7) -> list[tuple]:
    random.seed(seed)
    price, drift, out = 30000.0, 0.0, []
    for i in range(n):
        if i % 250 == 0:
            drift = random.uniform(-0.002, 0.0028)
        op = price
        price *= math.exp(drift + random.gauss(0, 0.018))
        out.append(
            (
                1_500_000_000 + i * granularity,
                op,
                max(op, price) * 1.004,
                min(op, price) * 0.996,
                price,
                1.0,
            )
        )
    return out


def ema(values: list[float], n: int) -> list[float]:
    k, value, out = 2 / (n + 1), values[0], []
    for x in values:
        value = x * k + value * (1 - k)
        out.append(value)
    return out


def sma(values: list[float], n: int) -> list[float]:
    out, total = [], 0.0
    for i, x in enumerate(values):
        total += x
        if i >= n:
            total -= values[i - n]
        out.append(total / min(i + 1, n))
    return out


def atr(candles: list[tuple], n: int = 14) -> list[float]:
    out, average = [], None
    for i, candle in enumerate(candles):
        high, low = candle[2], candle[3]
        tr = high - low if i == 0 else max(
            high - low,
            abs(high - candles[i - 1][4]),
            abs(low - candles[i - 1][4]),
        )
        average = tr if average is None else (average * (n - 1) + tr) / n
        out.append(average)
    return out


def rsi(values: list[float], n: int = 2) -> list[float]:
    out, avg_gain, avg_loss = [50.0], 0.0, 0.0
    for i in range(1, len(values)):
        delta = values[i] - values[i - 1]
        avg_gain = (avg_gain * (n - 1) + max(delta, 0)) / n
        avg_loss = (avg_loss * (n - 1) + max(-delta, 0)) / n
        out.append(100.0 if avg_loss == 0 else 100 - 100 / (1 + avg_gain / avg_loss))
    return out


def base_indicators(candles: list[tuple]) -> dict:
    close = [x[4] for x in candles]
    return {
        "cl": close,
        "hi": [x[2] for x in candles],
        "lo": [x[3] for x in candles],
        "atr": atr(candles),
        "ema200": ema(close, 200),
        "sma200": sma(close, 200),
        "rsi2": rsi(close, 2),
    }


def strategy_trend(ind: dict, p: dict) -> dict:
    fast = ema(ind["cl"], p["fast"])
    slow = ema(ind["cl"], p["slow"])
    return {
        "enter": [fast[i] > slow[i] and ind["cl"][i] > ind["ema200"][i] for i in range(len(fast))],
        "exit": [fast[i] < slow[i] for i in range(len(fast))],
    }


def strategy_breakout(ind: dict, p: dict) -> dict:
    hi, lo, cl, lookback, exit_n = ind["hi"], ind["lo"], ind["cl"], p["n"], p["m"]
    enter = [
        i >= lookback and cl[i] > max(hi[i - lookback : i]) and cl[i] > ind["ema200"][i]
        for i in range(len(cl))
    ]
    exit_ = [i >= exit_n and cl[i] < min(lo[i - exit_n : i]) for i in range(len(cl))]
    return {"enter": enter, "exit": exit_}


def strategy_meanrev(ind: dict, p: dict) -> dict:
    exit_avg = sma(ind["cl"], p["exit"])
    return {
        "enter": [ind["rsi2"][i] < p["buy"] and ind["cl"][i] > ind["sma200"][i] for i in range(len(exit_avg))],
        "exit": [ind["cl"][i] > exit_avg[i] for i in range(len(exit_avg))],
    }


STRATEGIES = {
    "trend": strategy_trend,
    "breakout": strategy_breakout,
    "meanrev": strategy_meanrev,
}
GRIDS = {
    "trend": [dict(fast=f, slow=s) for f in (10, 20, 30) for s in (50, 100)],
    "breakout": [dict(n=n, m=m) for n in (20, 40, 55) for m in (10, 20)],
    "meanrev": [dict(buy=b, exit=x) for b in (5, 10, 15) for x in (5, 10)],
}
ATR_MULT = {"trend": 3.0, "breakout": 2.5, "meanrev": 3.0}


class Engine:
    """Long-only spot simulator shared by backtests and paper trading."""

    def __init__(self, cash: float, fee: float, slip: float, risk: float, atr_k: float):
        self.fee, self.slip, self.risk, self.atr_k = fee, slip, risk, atr_k
        self.cash = cash
        self.qty = 0.0
        self.entry = 0.0
        self.cost = 0.0
        self.entry_t = 0
        self.stop = 0.0
        self.pending = None
        self.last_t = 0
        self.trades: list[dict] = []
        self.peak = cash
        self.halted = False
        self.halt_reason = ""

    def equity(self, price: float) -> float:
        return self.cash + self.qty * price

    def step(self, i: int, candles: list[tuple], signal: dict, atr_: list[float], max_dd: float | None = None):
        t, op, high, low, close, _ = candles[i]
        events = []
        self.last_t = t
        if self.pending == "buy" and self.qty == 0 and atr_[i - 1] > 0:
            px, distance = op * (1 + self.slip), self.atr_k * atr_[i - 1]
            risk_cash = self.equity(op) * self.risk
            qty = min(risk_cash / distance, self.cash / (px * (1 + self.fee)))
            if qty * px >= 1:
                self.cost = qty * px * (1 + self.fee)
                self.cash -= self.cost
                self.qty, self.entry, self.entry_t = qty, px, t
                self.stop = px - distance
                events.append({"side": "BUY", "t": utc_iso(t), "price": px, "qty": qty})
        elif self.pending == "sell" and self.qty > 0:
            events.append(self._exit(t, op * (1 - self.slip), "signal"))
        self.pending = None

        if self.qty > 0 and low <= self.stop:
            events.append(self._exit(t, min(op, self.stop) * (1 - self.slip), "stop"))
        if self.qty > 0:
            self.stop = max(self.stop, close - self.atr_k * atr_[i])

        eq = self.equity(close)
        self.peak = max(self.peak, eq)
        if max_dd and self.peak > 0 and eq < self.peak * (1 - max_dd):
            self.halted = True
            self.halt_reason = f"drawdown exceeded {max_dd:.1%}"
            if self.qty > 0:
                self.pending = "sell"

        if self.qty == 0 and signal["enter"][i] and not self.halted:
            self.pending = "buy"
        elif self.qty > 0 and signal["exit"][i]:
            self.pending = "sell"
        return events

    def _exit(self, t: int, px: float, reason: str) -> dict:
        proceeds = self.qty * px * (1 - self.fee)
        pnl = proceeds - self.cost
        trade = {
            "side": "SELL",
            "entry_t": utc_iso(self.entry_t),
            "exit_t": utc_iso(t),
            "entry": round(self.entry, 8),
            "exit": round(px, 8),
            "qty": self.qty,
            "pnl": round(pnl, 8),
            "pnl_pct": round(100 * pnl / self.cost, 4) if self.cost else 0.0,
            "reason": reason,
        }
        self.cash += proceeds
        self.qty = 0.0
        self.cost = 0.0
        self.trades.append(trade)
        return trade


def run(candles: list[tuple], signal: dict, ind: dict, i0: int, i1: int, cfg: dict, atr_k: float):
    engine = Engine(cfg["cash"], cfg["fee"], cfg["slip"], cfg["risk"], atr_k)
    equity = []
    for i in range(i0, i1):
        engine.step(i, candles, signal, ind["atr"])
        equity.append(engine.equity(candles[i][4]))
    return equity, engine.trades


def max_drawdown(values: list[float]) -> float:
    peak, dd = 0.0, 0.0
    for value in values:
        peak = max(peak, value)
        if peak > 0:
            dd = max(dd, 1 - value / peak)
    return dd


def metrics(equity: list[float], trades: list[dict], candles: list[tuple], i0: int, i1: int, cash: float) -> dict:
    if not equity or i1 <= i0:
        return {"ret": -1.0, "monthly": -1.0, "mdd": 1.0, "trades": 0, "win": 0.0, "pf": 0.0,
                "bh": 0.0, "bh_dd": 0.0, "days": 0.0}
    days = max(1e-9, (candles[i1 - 1][0] - candles[i0][0]) / 86400)
    growth = equity[-1] / cash
    wins = [t["pnl"] for t in trades if t["pnl"] > 0]
    losses = [t["pnl"] for t in trades if t["pnl"] <= 0]
    bh_prices = [x[4] for x in candles[i0:i1]]
    pf = sum(wins) / abs(sum(losses)) if losses and sum(losses) else (99.0 if wins else 0.0)
    return {
        "ret": growth - 1,
        "monthly": growth ** (30 / days) - 1 if growth > 0 else -1,
        "mdd": max_drawdown(equity),
        "trades": len(trades),
        "win": len(wins) / max(1, len(trades)),
        "pf": pf,
        "bh": bh_prices[-1] / candles[i0][1] - 1,
        "bh_dd": max_drawdown(bh_prices),
        "days": days,
    }


def objective(equity: list[float], trades: list[dict], cash: float) -> float:
    if len(trades) < 3 or not equity:
        return -1e9
    ret = equity[-1] / cash - 1
    dd = max_drawdown(equity)
    return ret / max(dd, 0.05)


def parameter_stability(chosen: list[dict]) -> float:
    if not chosen:
        return 0.0
    serial = [json.dumps(x, sort_keys=True) for x in chosen]
    mode_count = max(serial.count(x) for x in set(serial))
    return mode_count / len(serial)


def walk_forward(candles: list[tuple], name: str, cfg: dict, folds: int = 4, train: float = 0.4):
    ind = base_indicators(candles)
    atr_k = ATR_MULT[name]
    signal_grid = [(p, STRATEGIES[name](ind, p)) for p in GRIDS[name]]
    n = len(candles)
    train_end = WARM + int((n - WARM) * train)
    remaining = n - train_end
    if remaining < folds:
        raise ValueError("not enough candles for requested folds")
    step = remaining // folds
    engine = Engine(cfg["cash"], cfg["fee"], cfg["slip"], cfg["risk"], atr_k)
    equity, chosen, fold_stats = [], [], []
    selection_failures = 0
    for fold in range(folds):
        start = train_end + fold * step
        end = n if fold == folds - 1 else start + step

        train_rows = []
        for params, signal in signal_grid:
            tr_eq, tr_trades = run(candles, signal, ind, WARM, start, cfg, atr_k)
            train_rows.append((objective(tr_eq, tr_trades, cfg["cash"]), params, signal))
        train_rows.sort(key=lambda x: x[0], reverse=True)
        selected_train_score, params, signal = train_rows[0]
        chosen.append(params)

        candidate_oos = []
        for train_score, trial_params, trial_signal in train_rows:
            te_eq, te_trades = run(candles, trial_signal, ind, start, end, cfg, atr_k)
            te_ret = te_eq[-1] / cfg["cash"] - 1 if te_eq else -1.0
            te_dd = max_drawdown(te_eq) if te_eq else 1.0
            te_obj = objective(te_eq, te_trades, cfg["cash"])
            candidate_oos.append({
                "params": trial_params,
                "train_objective": train_score,
                "oos_return": te_ret,
                "oos_mdd": te_dd,
                "oos_objective": te_obj,
                "oos_trades": len(te_trades),
                "selected_in_sample": trial_params == params,
            })
        candidate_oos.sort(key=lambda x: x["oos_objective"], reverse=True)
        selected_rank = next(
            (idx + 1 for idx, row in enumerate(candidate_oos) if row["selected_in_sample"]),
            len(candidate_oos),
        )
        bottom_half = selected_rank > max(1, len(candidate_oos) / 2)
        selection_failures += int(bottom_half)

        fold_start_equity = engine.equity(candles[start][1])
        fold_equity, before_trades = [], len(engine.trades)
        for i in range(start, end):
            engine.step(i, candles, signal, ind["atr"])
            value = engine.equity(candles[i][4])
            equity.append(value)
            fold_equity.append(value)
        fold_return = fold_equity[-1] / fold_start_equity - 1 if fold_equity and fold_start_equity else 0.0
        fold_stats.append({
            "fold": fold + 1,
            "start": utc_iso(candles[start][0]),
            "end": utc_iso(candles[end - 1][0]),
            "params": params,
            "return": fold_return,
            "mdd": max_drawdown(fold_equity),
            "trades": len(engine.trades) - before_trades,
            "selection_audit": {
                "trial_count": len(candidate_oos),
                "selected_train_objective": selected_train_score,
                "selected_oos_rank": selected_rank,
                "selected_oos_bottom_half": bottom_half,
                "candidate_oos": candidate_oos,
            },
        })
    result = metrics(equity, engine.trades, candles, train_end, n, cfg["cash"])
    result["param_stability"] = parameter_stability(chosen)
    result["positive_folds"] = sum(1 for f in fold_stats if f["return"] > 0)
    result["folds"] = len(fold_stats)
    result["selection_trials_per_fold"] = len(signal_grid)
    result["selection_failure_rate"] = selection_failures / max(1, folds)
    return result, engine.trades, chosen, fold_stats


def verdict(m: dict) -> str:
    ok = (
        m["ret"] > 0
        and m["pf"] >= 1.20
        and m["trades"] >= 15
        and m["mdd"] <= 0.25
        and m.get("positive_folds", 0) >= max(2, math.ceil(m.get("folds", 4) * 0.5))
        and m.get("param_stability", 0) >= 0.50
    )
    return "PASS" if ok else "FAIL"


def missing_bar_ratio(candles: list[tuple], granularity: int) -> float:
    if len(candles) < 2:
        return 1.0
    expected = max(1, int((candles[-1][0] - candles[0][0]) / granularity) + 1)
    return max(0.0, 1 - len(candles) / expected)


def write_ledger(path: Path, trades: list[dict]) -> None:
    if not trades:
        path.write_text("", encoding="utf-8")
        return
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(trades[0]))
        writer.writeheader()
        writer.writerows(trades)


def cmd_scan(args) -> None:
    cfg = {"cash": args.cash, "fee": args.fee, "slip": args.slip, "risk": args.risk}
    products = ["SYNTH"] if args.synthetic else [p.strip().upper() for p in args.products.split(",") if p.strip()]
    results = []
    for product in products:
        try:
            candles = synthetic(granularity=args.gran) if args.synthetic else fetch(product, args.gran, args.days)
        except Exception as exc:
            print(f"{product}: data error: {exc}")
            continue
        if len(candles) < WARM + 400:
            print(f"{product}: not enough history ({len(candles)} candles)")
            continue
        gap_ratio = missing_bar_ratio(candles, args.gran)
        for name in STRATEGIES:
            m, trades, chosen, fold_stats = walk_forward(candles, name, cfg, folds=args.folds, train=args.train)
            row = {
                "market": product,
                "strategy": name,
                "metrics": m,
                "chosen": chosen,
                "fold_stats": fold_stats,
                "verdict": verdict(m),
                "missing_bar_ratio": gap_ratio,
            }
            results.append(row)
            write_ledger(ROOT / f"ledger_{product}_{name}.csv", trades)
    if not results:
        raise SystemExit("No results.")
    results.sort(key=lambda r: (r["verdict"] == "PASS", r["metrics"]["monthly"], r["metrics"]["ret"]), reverse=True)
    print(
        f"\nWALK-FORWARD, UNSEEN DATA ONLY  (fee {args.fee*100:.2f}%/side, slippage {args.slip*100:.2f}%, "
        f"risk {args.risk*100:.1f}%/trade, candles {args.gran/3600:g}h)"
    )
    if args.synthetic:
        print("SYNTHETIC DATA: code-path test only; results are not evidence of an edge.")
    print(f"{'market':10} {'strategy':9} {'return':>8} {'/month':>8} {'maxDD':>7} {'trades':>7} {'PF':>5} {'folds+':>7} {'stable':>7} verdict")
    with (ROOT / "results.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(["market", "strategy", "ret", "monthly", "mdd", "trades", "win", "pf", "bh", "bh_dd", "positive_folds", "param_stability", "verdict", "params"])
        for row in results:
            m = row["metrics"]
            print(
                f"{row['market']:10} {row['strategy']:9} {m['ret']*100:+7.1f}% {m['monthly']*100:+7.2f}% "
                f"{m['mdd']*100:6.1f}% {m['trades']:7} {min(m['pf'],99):5.2f} "
                f"{m['positive_folds']:3}/{m['folds']:<3} {m['param_stability']*100:6.0f}% {row['verdict']}"
            )
            writer.writerow([row["market"], row["strategy"], m["ret"], m["monthly"], m["mdd"], m["trades"], m["win"], m["pf"], m["bh"], m["bh_dd"], m["positive_folds"], m["param_stability"], row["verdict"], json.dumps(row["chosen"], sort_keys=True)])
    status = {
        "schema": "andys-bot-strategy-lab-v3",
        "generated_utc": utc_iso(time.time()),
        "mode": "synthetic" if args.synthetic else "public_coinbase_data",
        "granularity_seconds": args.gran,
        "days_requested": args.days,
        "assumptions": {"cash": args.cash, "fee": args.fee, "fee_mode": "maker" if args.maker else "manual", "slippage": args.slip, "risk_per_trade": args.risk},
        "results": results,
        "best": results[0],
        "pass_count": sum(1 for r in results if r["verdict"] == "PASS"),
        "live_orders_enabled": False,
    }
    atomic_json(STATE / "strategy_lab_status.json", status)
    best = results[0]
    print(f"\nBest validation row: {best['market']} {best['strategy']} — {best['verdict']}")
    print(f"Machine output: {STATE / 'strategy_lab_status.json'}")
    print("No live-order path exists in this program.")


def telegram(msg: str) -> None:
    token, chat = os.environ.get("TELEGRAM_TOKEN"), os.environ.get("TELEGRAM_CHAT")
    if not (token and chat):
        return
    try:
        data = urllib.parse.urlencode({"chat_id": chat, "text": msg}).encode()
        urllib.request.urlopen(f"https://api.telegram.org/bot{token}/sendMessage", data, timeout=10)
    except Exception as exc:
        print("telegram error:", exc)


def restore_engine(path: Path, engine: Engine, params: dict) -> dict:
    if not path.exists():
        return params
    try:
        state = json.loads(path.read_text(encoding="utf-8"))
        params = state.pop("params", params)
        for key, value in state.items():
            if key in engine.__dict__:
                engine.__dict__[key] = value
    except Exception as exc:
        print("paper state ignored:", exc)
    return params


def cmd_paper(args) -> None:
    cfg = {"cash": args.cash, "fee": args.fee, "slip": args.slip, "risk": args.risk}
    name = args.strategy
    if args.params == "auto":
        candles = fetch(args.product, args.gran, args.days)
        _, _, chosen, _ = walk_forward(candles, name, cfg, folds=args.folds, train=args.train)
        params = chosen[-1]
    else:
        params = json.loads(args.params)
    state_file = STATE / f"paper_{args.product}_{name}.json"
    ledger_file = ROOT / f"paper_ledger_{args.product}_{name}.csv"
    engine = Engine(args.cash, args.fee, args.slip, args.risk, ATR_MULT[name])
    params = restore_engine(state_file, engine, params)
    print(f"PAPER {args.product} {name} {params} (no real orders). Ctrl-C to stop.")
    days = math.ceil((WARM + 120) * args.gran / 86400) + 1
    while True:
        try:
            candles = fetch(args.product, args.gran, days)
            ind = base_indicators(candles)
            signal = STRATEGIES[name](ind, params)
            if not engine.last_t:
                engine.last_t = candles[-1][0]
            for i in range(1, len(candles)):
                if candles[i][0] <= engine.last_t:
                    continue
                for event in engine.step(i, candles, signal, ind["atr"], max_dd=args.max_dd):
                    msg = f"[PAPER {args.product}] " + " ".join(f"{k}={v}" for k, v in event.items())
                    print(msg)
                    telegram(msg)
                    if event["side"] == "SELL":
                        new_file = not ledger_file.exists() or ledger_file.stat().st_size == 0
                        with ledger_file.open("a", newline="", encoding="utf-8") as handle:
                            writer = csv.DictWriter(handle, fieldnames=list(event))
                            if new_file:
                                writer.writeheader()
                            writer.writerow(event)
            atomic_json(state_file, {**engine.__dict__, "params": params})
            price = candles[-1][4]
            print(
                f"{utc_iso(time.time())} equity GBP {engine.equity(price):,.2f} | holding {engine.qty:.8f} | "
                f"stop {engine.stop:,.2f} | pending {engine.pending}" +
                (f" | HALTED: {engine.halt_reason}" if engine.halted else "")
            )
        except KeyboardInterrupt:
            raise
        except Exception as exc:
            print("error (will retry):", exc)
        sleep_for = max(5, (int(time.time()) // args.gran + 1) * args.gran + 30 - time.time())
        time.sleep(sleep_for)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Andy's Bot Strategy Lab R7.4 (no real orders)")
    parser.add_argument("mode", choices=["scan", "paper"])
    parser.add_argument("--products", default="BTC-GBP,ETH-GBP")
    parser.add_argument("--product", default="BTC-GBP")
    parser.add_argument("--strategy", choices=list(STRATEGIES), default="trend")
    parser.add_argument("--params", default="auto")
    parser.add_argument("--gran", type=int, default=21600, choices=[3600, 21600, 86400])
    parser.add_argument("--days", type=int, default=1460)
    parser.add_argument("--cash", type=float, default=1000.0)
    parser.add_argument("--fee", type=float, default=0.006, help="per side; verify actual Coinbase tier")
    parser.add_argument("--maker", action="store_true", help="use maker-fee assumption instead of --fee")
    parser.add_argument("--maker-fee", type=float, default=0.0025, help="maker fee per side used with --maker; account tier may differ")
    parser.add_argument("--slip", type=float, default=0.001)
    parser.add_argument("--risk", type=float, default=0.02)
    parser.add_argument("--max-dd", dest="max_dd", type=float, default=0.25)
    parser.add_argument("--folds", type=int, default=4)
    parser.add_argument("--train", type=float, default=0.40)
    parser.add_argument("--synthetic", action="store_true")
    return parser


if __name__ == "__main__":
    args = build_parser().parse_args()
    if args.maker:
        args.fee = args.maker_fee
    if not (0 < args.risk <= 0.10):
        raise SystemExit("--risk must be > 0 and <= 0.10")
    if not (0 <= args.fee < 0.05 and 0 <= args.slip < 0.05):
        raise SystemExit("fee/slippage assumptions are outside sane bounds")
    if not (2 <= args.folds <= 12 and 0.2 <= args.train <= 0.8):
        raise SystemExit("use 2-12 folds and train fraction 0.2-0.8")
    {"scan": cmd_scan, "paper": cmd_paper}[args.mode](args)
