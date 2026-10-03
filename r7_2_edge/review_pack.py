from __future__ import annotations

import json
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Optional

from .engine import Evidence, MarketRegime, R72Config


@dataclass
class ReviewPack:
    manifest: Dict[str, Any]
    settings: Dict[str, Any]
    confidence: Dict[str, Any]
    trade_metrics: Dict[str, Any]
    regime: Dict[str, Any]
    fee_override: Dict[str, Any]

    @classmethod
    def from_zip(cls, path: str | Path) -> "ReviewPack":
        path = Path(path)
        with zipfile.ZipFile(path) as z:
            prefix = "Andys_Bot_Review_Pack/"
            def read_json(name: str) -> Dict[str, Any]:
                return json.loads(z.read(prefix + name))
            def read_optional(name: str) -> Dict[str, Any]:
                try:
                    return json.loads(z.read(prefix + name))
                except KeyError:
                    return {}
            return cls(
                manifest=read_json("MANIFEST.json"),
                settings=read_json("SETTINGS_SANITIZED.json"),
                confidence=read_json("CONFIDENCE_CALIBRATION.json"),
                trade_metrics=read_json("TRADE_METRICS.json"),
                regime=read_json("BTC_REGIME_BREADTH.json"),
                fee_override=read_optional("evidence/coinbase_fee_override.json"),
            )

    def config(self) -> R72Config:
        s = self.settings
        f = self.fee_override
        return R72Config(
            min_evidence_probability=max(0.58, float(s.get("live_min_probability", 0.58))),
            min_net_edge=max(0.003, float(s.get("live_min_edge_after_preview", 0.003))),
            min_reward_risk=max(1.20, float(s.get("minimum_net_target_rr", 1.20))),
            min_council_score=max(60.0, float(s.get("live_min_council_score", 60.0))),
            min_activity_score=max(50.0, float(s.get("live_min_activity_score", 50.0))),
            maker_fee_rate=float(f.get("maker_fee_rate", s.get("coinbase_maker_fee", 0.0007))),
            taker_fee_rate=float(f.get("taker_fee_rate", s.get("coinbase_taker_fee", 0.0016))),
            weak_breadth_block_score=float(s.get("altcoin_breadth_weak_score", 30.0)),
            supportive_breadth_score=float(s.get("altcoin_breadth_supportive_score", 55.0)),
            max_order_gbp=float(s.get("live_order_cap_gbp", 15.0)),
            max_total_exposure_gbp=float(s.get("live_max_total_exposure_gbp", 100.0)),
            max_positions=int(s.get("live_max_positions", 8)),
            max_orders_per_day=int(s.get("live_max_orders_per_day", 4)),
            strategy_lab_min_profit_factor=max(1.15, float(s.get("strategy_lab_min_profit_factor", 1.15))),
            strategy_lab_max_drawdown=min(0.12, float(s.get("strategy_lab_max_drawdown", 0.12))),
        )

    def market_regime(self) -> MarketRegime:
        btc = self.regime.get("btc", {})
        b = self.regime.get("breadth", {})
        return MarketRegime(
            btc_state=str(btc.get("state", "UNKNOWN")),
            btc_return_24h=float(btc.get("return_24h", 0.0) or 0.0),
            btc_above_ema20=bool(btc.get("above_ema20", False)),
            breadth_state=str(b.get("state", "UNKNOWN")),
            breadth_score=float(b.get("score", 50.0) or 0.0),
            positive_24h_fraction=float(b.get("positive_24h_fraction", 0.5) or 0.0),
            above_ema20_fraction=float(b.get("above_ema20_fraction", 0.5) or 0.0),
        )

    def evidence_for(self, symbol: str) -> Optional[Evidence]:
        row = self.confidence.get("symbols", {}).get(symbol.upper())
        if not row:
            return None
        return Evidence(
            model_probability=float(row.get("calibrated_probability", row.get("raw_probability", 0.5))),
            observed_after_cost_hit_rate=(None if row.get("observed_after_cost_hit_rate") is None else float(row.get("observed_after_cost_hit_rate"))),
            samples=int(row.get("samples", 0) or 0),
            calibration_reliability=float(row.get("reliability", 1.0) or 0.0),
            source=str(row.get("source", "unknown")),
        )

    def symbol_metrics(self, symbol: str) -> Optional[Dict[str, Any]]:
        return self.trade_metrics.get("normal", {}).get("symbols", {}).get(symbol.upper())
