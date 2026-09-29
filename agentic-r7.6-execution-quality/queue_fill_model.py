#!/usr/bin/env python3
"""Conservative shadow fill helpers inspired by queue-aware L2 replay.

No exchange connectivity.  Used to make paper/backtest fill assumptions less
optimistic than 'price touched => fully filled'.
"""
from __future__ import annotations
from dataclasses import dataclass


@dataclass
class QueueFillTracker:
    side: str
    price: float
    order_qty: float
    qty_ahead: float
    filled_qty: float = 0.0

    def on_level_update(self, displayed_qty: float | None, deleted: bool = False) -> None:
        if deleted or displayed_qty is None or displayed_qty <= 0:
            self.qty_ahead = 0.0
            return
        # New visible liquidity does not move our historical simulated order
        # backwards; reductions can move it forwards.
        self.qty_ahead = min(self.qty_ahead, float(displayed_qty))

    def on_trade(self, trade_price: float, trade_qty: float, aggressor_side: str) -> float:
        if self.filled_qty >= self.order_qty or trade_qty <= 0:
            return 0.0
        side = self.side.upper()
        aggressor = aggressor_side.upper()
        eligible = (
            side == "BUY" and aggressor == "SELL" and trade_price <= self.price
        ) or (
            side == "SELL" and aggressor == "BUY" and trade_price >= self.price
        )
        if not eligible:
            return 0.0
        remaining_trade = float(trade_qty)
        consumed_ahead = min(self.qty_ahead, remaining_trade)
        self.qty_ahead -= consumed_ahead
        remaining_trade -= consumed_ahead
        fill = min(self.order_qty - self.filled_qty, remaining_trade)
        self.filled_qty += fill
        return fill

    @property
    def done(self) -> bool:
        return self.filled_qty >= self.order_qty


def walk_buy_quote(quote_amount: float, asks: list[tuple[float, float]]) -> dict:
    """Walk ask levels `(price, base_qty)` for a quote-currency BUY amount."""
    if quote_amount <= 0 or not asks:
        return {"filled": False, "avg_price": None, "base_qty": 0.0, "slippage_bps": None}
    levels = sorted((float(p), float(q)) for p, q in asks if p > 0 and q > 0)
    if not levels:
        return {"filled": False, "avg_price": None, "base_qty": 0.0, "slippage_bps": None}
    remaining = float(quote_amount)
    spent = 0.0
    base = 0.0
    best = levels[0][0]
    for price, qty in levels:
        level_quote = price * qty
        take_quote = min(remaining, level_quote)
        take_base = take_quote / price
        spent += take_quote
        base += take_base
        remaining -= take_quote
        if remaining <= 1e-9:
            break
    filled = remaining <= 1e-9
    avg = spent / base if base > 0 else None
    slip = ((avg / best) - 1.0) * 10_000.0 if avg and best else None
    return {
        "filled": filled,
        "avg_price": avg,
        "base_qty": base,
        "quote_spent": spent,
        "unfilled_quote": max(0.0, remaining),
        "slippage_bps": slip,
    }
