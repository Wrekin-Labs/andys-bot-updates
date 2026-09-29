#!/usr/bin/env python3
"""R7.6 shadow-only crypto microstructure quality model.

Uses only observable market data already present in Andy's Bot payloads.  It is
an advisory/veto research layer: it cannot create a trade, size an order, arm
live trading, or contact an order endpoint.
"""
from __future__ import annotations
import math
from typing import Any


def num(v: Any, d: float = 0.0) -> float:
    try:
        x = float(v)
        return x if math.isfinite(x) else d
    except Exception:
        return d


def clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def _first(d: dict, names: tuple[str, ...], default: float = 0.0) -> float:
    for name in names:
        if name in d and d.get(name) is not None:
            return num(d.get(name), default)
    return default


def _norm_pressure(v: float) -> float:
    # Normalize common [-100,100] or [-1,1] score conventions into [-1,1].
    return clamp(v / 100.0 if abs(v) > 1.5 else v, -1.0, 1.0)


def assess(asset: dict, config: dict | None = None, side: str = "BUY") -> dict:
    cfg = config or {}
    book = asset.get("coinbase_orderbook") or asset.get("book") or {}
    bid = _first(book, ("best_bid", "bid"))
    ask = _first(book, ("best_ask", "ask"))
    bid_qty = _first(book, ("best_bid_size", "bid_size", "bid_qty", "bid_quantity"))
    ask_qty = _first(book, ("best_ask_size", "ask_size", "ask_qty", "ask_quantity"))
    bid_depth = _first(book, ("bid_depth_5_gbp", "bid_depth_gbp", "bid_depth"))
    ask_depth = _first(book, ("ask_depth_5_gbp", "ask_depth_gbp", "ask_depth"))
    age = _first(book, ("age_seconds", "book_age_seconds", "l2_age_seconds"), 0.0)
    stale = bool(book.get("stale")) or age > num(cfg.get("max_book_age_seconds"), 8.0)

    reasons: list[str] = []
    if bid <= 0 or ask <= bid:
        return {
            "ok": False, "allowed": False, "quality_score": 0.0,
            "directional_score": 0.0, "adverse_selection_risk": 100.0,
            "reasons": ["invalid or crossed top of book"],
            "can_create_trade": False,
        }

    mid = (bid + ask) / 2.0
    spread_bps = (ask - bid) / mid * 10_000.0
    top_imb = (bid_qty - ask_qty) / (bid_qty + ask_qty) if bid_qty > 0 and ask_qty > 0 else 0.0
    depth_imb = (bid_depth - ask_depth) / (bid_depth + ask_depth) if bid_depth > 0 and ask_depth > 0 else 0.0

    microprice = mid
    if bid_qty > 0 and ask_qty > 0:
        # Opposite-side quantity weighting: more bid size pulls microprice upward.
        microprice = (ask * bid_qty + bid * ask_qty) / (bid_qty + ask_qty)
    micro_shift_bps = (microprice - mid) / mid * 10_000.0
    spread_half = max(spread_bps / 2.0, 0.1)
    micro_norm = clamp(micro_shift_bps / spread_half, -1.0, 1.0)

    flow = asset.get("order_flow") or asset.get("coin_flow") or {}
    pressure_raw = _first(flow, (
        "trade_pressure_score", "trade_pressure", "score", "edge_score",
        "order_flow_imbalance", "imbalance",
    ))
    pressure = _norm_pressure(pressure_raw)

    directional = 100.0 * clamp(
        top_imb * 0.30 + depth_imb * 0.25 + micro_norm * 0.20 + pressure * 0.25,
        -1.0, 1.0,
    )
    if side.upper() == "SELL":
        directional = -directional

    max_spread = max(1.0, num(cfg.get("max_spread_bps"), 25.0))
    spread_quality = clamp(1.0 - spread_bps / max_spread, 0.0, 1.0)
    depth_target = max(1.0, num(cfg.get("depth_target_gbp"), 500.0))
    depth_quality = clamp(min(bid_depth, ask_depth) / depth_target, 0.0, 1.0) if bid_depth and ask_depth else 0.35
    freshness = 0.0 if stale else clamp(1.0 - age / max(1.0, num(cfg.get("max_book_age_seconds"), 8.0)), 0.25, 1.0)
    quality = 100.0 * (0.45 * spread_quality + 0.35 * depth_quality + 0.20 * freshness)

    # Risk is intentionally asymmetric: wide/stale books dominate, while an
    # extreme directional imbalance that is contradicted by trade pressure is
    # treated as a potential adverse-selection warning.
    conflict = abs(top_imb) if top_imb * pressure < -0.10 else 0.0
    risk = 100.0 * clamp(
        (1.0 - spread_quality) * 0.40 + (1.0 - freshness) * 0.30 +
        conflict * 0.20 + (1.0 - depth_quality) * 0.10,
        0.0, 1.0,
    )

    min_quality = num(cfg.get("min_quality_score"), 45.0)
    max_risk = num(cfg.get("max_adverse_selection_risk"), 65.0)
    if stale:
        reasons.append("order book is stale")
    if spread_bps > max_spread:
        reasons.append(f"spread {spread_bps:.1f} bps exceeds {max_spread:.1f}")
    if quality < min_quality:
        reasons.append(f"microstructure quality {quality:.1f}/100 below {min_quality:.1f}")
    if risk > max_risk:
        reasons.append(f"adverse-selection risk {risk:.1f}/100 above {max_risk:.1f}")

    return {
        "ok": True,
        "allowed": not reasons,
        "side": side.upper(),
        "mid": round(mid, 12),
        "microprice": round(microprice, 12),
        "microprice_shift_bps": round(micro_shift_bps, 4),
        "spread_bps": round(spread_bps, 4),
        "top_imbalance": round(top_imb, 5),
        "depth_imbalance": round(depth_imb, 5),
        "trade_pressure": round(pressure, 5),
        "directional_score": round(directional, 2),
        "quality_score": round(quality, 2),
        "adverse_selection_risk": round(risk, 2),
        "book_age_seconds": round(age, 3),
        "reasons": reasons,
        "can_create_trade": False,
        "policy": "Shadow-only quality/veto evidence; never originates an order.",
    }
