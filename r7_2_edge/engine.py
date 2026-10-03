from __future__ import annotations

from dataclasses import dataclass, field, asdict
from math import sqrt
from typing import Any, Dict, List, Optional, Tuple


def clamp(value: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, float(value)))


def wilson_lower_bound(hit_rate: float, samples: int, z: float = 1.96) -> float:
    n = max(0, int(samples))
    if n == 0:
        return 0.0
    p = clamp(hit_rate)
    z2 = z * z
    denom = 1.0 + z2 / n
    centre = p + z2 / (2.0 * n)
    adj = z * sqrt((p * (1.0 - p) + z2 / (4.0 * n)) / n)
    return clamp((centre - adj) / denom)


def sample_reliability(samples: int, full_weight_samples: int = 120) -> float:
    n = max(0, int(samples))
    if full_weight_samples <= 0:
        return 1.0
    return clamp(n / float(full_weight_samples))


@dataclass(frozen=True)
class Evidence:
    model_probability: float
    observed_after_cost_hit_rate: Optional[float] = None
    samples: int = 0
    calibration_reliability: float = 1.0
    source: str = "unknown"


@dataclass(frozen=True)
class Candidate:
    symbol: str
    expected_gross_return: float
    model_probability: float
    council_score: float = 0.0
    activity_score: float = 0.0
    spread_bps: float = 0.0
    slippage_bps: float = 0.0
    order_style: str = "taker"
    bucket: str = "default"
    mtf_score: float = 0.0
    reward_risk: float = 0.0
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class MarketRegime:
    btc_state: str = "UNKNOWN"
    btc_return_24h: float = 0.0
    btc_above_ema20: bool = False
    breadth_state: str = "UNKNOWN"
    breadth_score: float = 50.0
    positive_24h_fraction: float = 0.5
    above_ema20_fraction: float = 0.5


@dataclass(frozen=True)
class StrategyLabEvidence:
    oos_trades: int
    profit_factor: float
    max_drawdown: float
    positive_folds: int
    total_folds: int
    median_fold_return: float
    cost_stress_profit_factor: Optional[float] = None


@dataclass
class R72Config:
    min_evidence_probability: float = 0.58
    min_empirical_hit_rate: float = 0.40
    min_empirical_samples: int = 30
    min_net_edge: float = 0.0030
    min_reward_risk: float = 1.20
    min_council_score: float = 60.0
    min_activity_score: float = 50.0
    empirical_blend_weight: float = 0.65
    evidence_full_weight_samples: int = 120
    min_wilson_lower_bound: float = 0.25
    maker_fee_rate: float = 0.0007
    taker_fee_rate: float = 0.0016
    cost_safety_multiplier: float = 1.20
    weak_breadth_block_score: float = 30.0
    supportive_breadth_score: float = 55.0
    down_regime_cap: float = 0.0
    weak_regime_cap: float = 0.10
    neutral_regime_cap: float = 0.50
    supportive_regime_cap: float = 1.0
    max_order_gbp: float = 15.0
    max_total_exposure_gbp: float = 100.0
    max_positions: int = 8
    max_orders_per_day: int = 4
    max_same_bucket_positions: int = 2
    symbol_min_closed_trades_for_full_size: int = 10
    symbol_loss_throttle_threshold_gbp: float = -0.50
    symbol_loss_throttle_multiplier: float = 0.25
    symbol_no_win_throttle_multiplier: float = 0.10
    strategy_lab_min_oos_trades: int = 30
    strategy_lab_min_profit_factor: float = 1.15
    strategy_lab_max_drawdown: float = 0.12
    strategy_lab_min_positive_fold_fraction: float = 0.75
    strategy_lab_min_median_fold_return: float = 0.0
    strategy_lab_min_cost_stress_profit_factor: float = 1.0


@dataclass(frozen=True)
class Decision:
    action: str
    symbol: str
    evidence_probability: float
    wilson_hit_rate_lower: float
    net_edge: float
    regime_cap: float
    stake_multiplier: float
    max_stake_gbp: float
    reasons: Tuple[str, ...]
    diagnostics: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class R72EdgeEngine:
    """Evidence-weighted entry gate. No execution methods exist by design."""

    def __init__(self, config: Optional[R72Config] = None):
        self.config = config or R72Config()

    def evidence_probability(self, evidence: Evidence) -> Tuple[float, float, float]:
        model_p = clamp(evidence.model_probability)
        if evidence.observed_after_cost_hit_rate is None or evidence.samples <= 0:
            return clamp(model_p - 0.10), 0.0, 0.0
        hit = clamp(evidence.observed_after_cost_hit_rate)
        rel = sample_reliability(evidence.samples, self.config.evidence_full_weight_samples)
        rel *= clamp(evidence.calibration_reliability)
        lower = wilson_lower_bound(hit, evidence.samples)
        empirical_w = self.config.empirical_blend_weight * max(0.25, rel)
        empirical_w = clamp(empirical_w, 0.0, 0.90)
        blended = model_p * (1.0 - empirical_w) + hit * empirical_w
        uncertainty_penalty = 0.08 * (1.0 - rel)
        return clamp(blended - uncertainty_penalty), lower, rel

    def round_trip_cost(self, candidate: Candidate) -> float:
        fee = self.config.maker_fee_rate if candidate.order_style.lower() == "maker" else self.config.taker_fee_rate
        spread = max(0.0, candidate.spread_bps) / 10_000.0
        slippage = max(0.0, candidate.slippage_bps) / 10_000.0
        raw = (2.0 * fee) + (2.0 * spread) + (2.0 * slippage)
        return raw * self.config.cost_safety_multiplier

    def net_edge(self, candidate: Candidate) -> float:
        return float(candidate.expected_gross_return) - self.round_trip_cost(candidate)

    def regime_cap(self, regime: MarketRegime) -> Tuple[float, List[str]]:
        reasons: List[str] = []
        weak = regime.breadth_state.upper() == "WEAK" or regime.breadth_score < self.config.weak_breadth_block_score
        down = regime.btc_return_24h < -0.015 and not regime.btc_above_ema20
        if down and weak:
            return self.config.down_regime_cap, ["BTC_DOWN_AND_BREADTH_WEAK"]
        if weak:
            return self.config.weak_regime_cap, ["BREADTH_WEAK"]
        if regime.breadth_score < self.config.supportive_breadth_score or not regime.btc_above_ema20:
            return self.config.neutral_regime_cap, ["REGIME_NOT_FULLY_SUPPORTIVE"]
        return self.config.supportive_regime_cap, ["REGIME_SUPPORTIVE"]

    def symbol_multiplier(self, symbol_metrics: Optional[Dict[str, Any]]) -> Tuple[float, List[str]]:
        if not symbol_metrics:
            return 0.50, ["SYMBOL_EVIDENCE_SPARSE"]
        closed = int(symbol_metrics.get("closed", 0) or 0)
        wins = int(symbol_metrics.get("wins", 0) or 0)
        pnl = float(symbol_metrics.get("pnl_gbp", 0.0) or 0.0)
        m = 1.0
        reasons: List[str] = []
        if closed < self.config.symbol_min_closed_trades_for_full_size:
            m *= max(0.25, closed / float(self.config.symbol_min_closed_trades_for_full_size))
            reasons.append("SYMBOL_SAMPLE_SMALL")
        if closed >= 2 and wins == 0:
            m = min(m, self.config.symbol_no_win_throttle_multiplier)
            reasons.append("SYMBOL_NO_WINS")
        if pnl <= self.config.symbol_loss_throttle_threshold_gbp:
            m = min(m, self.config.symbol_loss_throttle_multiplier)
            reasons.append("SYMBOL_REALIZED_LOSS_THROTTLE")
        return clamp(m), reasons

    def evaluate(self, candidate: Candidate, evidence: Evidence, regime: MarketRegime,
                 symbol_metrics: Optional[Dict[str, Any]] = None, open_positions: int = 0,
                 same_bucket_positions: int = 0, orders_today: int = 0,
                 current_exposure_gbp: float = 0.0) -> Decision:
        reasons: List[str] = []
        evidence_p, lower, rel = self.evidence_probability(evidence)
        net = self.net_edge(candidate)
        rcap, rreasons = self.regime_cap(regime)
        reasons.extend(rreasons)
        smult, sreasons = self.symbol_multiplier(symbol_metrics)
        reasons.extend(sreasons)
        hard_block = False
        paper_only = False
        if evidence.samples < self.config.min_empirical_samples:
            paper_only = True
            reasons.append("EMPIRICAL_SAMPLE_TOO_SMALL")
        if evidence.observed_after_cost_hit_rate is not None:
            if evidence.observed_after_cost_hit_rate < self.config.min_empirical_hit_rate:
                hard_block = True
                reasons.append("EMPIRICAL_AFTER_COST_HIT_RATE_LOW")
            if lower < self.config.min_wilson_lower_bound:
                hard_block = True
                reasons.append("EMPIRICAL_LOWER_BOUND_LOW")
        else:
            paper_only = True
            reasons.append("NO_EMPIRICAL_AFTER_COST_EVIDENCE")
        if evidence_p < self.config.min_evidence_probability:
            hard_block = True
            reasons.append("EVIDENCE_PROBABILITY_LOW")
        if net < self.config.min_net_edge:
            hard_block = True
            reasons.append("NET_EDGE_AFTER_COSTS_LOW")
        if candidate.reward_risk < self.config.min_reward_risk:
            hard_block = True
            reasons.append("REWARD_RISK_LOW")
        if candidate.council_score < self.config.min_council_score:
            hard_block = True
            reasons.append("COUNCIL_SCORE_LOW")
        if candidate.activity_score < self.config.min_activity_score:
            hard_block = True
            reasons.append("ACTIVITY_SCORE_LOW")
        if rcap <= 0.0:
            hard_block = True
            reasons.append("REGIME_CAP_ZERO")
        if open_positions >= self.config.max_positions:
            hard_block = True
            reasons.append("MAX_POSITIONS")
        if same_bucket_positions >= self.config.max_same_bucket_positions:
            hard_block = True
            reasons.append("CORRELATION_BUCKET_FULL")
        if orders_today >= self.config.max_orders_per_day:
            hard_block = True
            reasons.append("DAILY_ORDER_LIMIT")
        remaining_exposure = max(0.0, self.config.max_total_exposure_gbp - current_exposure_gbp)
        if remaining_exposure <= 0:
            hard_block = True
            reasons.append("TOTAL_EXPOSURE_LIMIT")
        stake_mult = clamp(rcap * smult)
        max_stake = min(self.config.max_order_gbp * stake_mult, remaining_exposure)
        if max_stake < 1.0:
            paper_only = True
            reasons.append("STAKE_THROTTLED_BELOW_LIVE_MINIMUM")
        action = "BLOCK" if hard_block else ("PAPER_ONLY" if paper_only else "ALLOW")
        return Decision(action, candidate.symbol.upper(), evidence_p, lower, net, rcap,
                        stake_mult, max_stake, tuple(dict.fromkeys(reasons)), {
                            "sample_reliability": rel,
                            "round_trip_cost": self.round_trip_cost(candidate),
                            "model_probability": candidate.model_probability,
                            "observed_after_cost_hit_rate": evidence.observed_after_cost_hit_rate,
                            "samples": evidence.samples,
                        })

    def qualify_strategy(self, evidence: StrategyLabEvidence) -> Tuple[bool, Tuple[str, ...]]:
        reasons: List[str] = []
        if evidence.oos_trades < self.config.strategy_lab_min_oos_trades:
            reasons.append("OOS_TRADES_TOO_FEW")
        if evidence.profit_factor < self.config.strategy_lab_min_profit_factor:
            reasons.append("PROFIT_FACTOR_TOO_LOW")
        if evidence.max_drawdown > self.config.strategy_lab_max_drawdown:
            reasons.append("DRAWDOWN_TOO_HIGH")
        if evidence.positive_folds / max(1, evidence.total_folds) < self.config.strategy_lab_min_positive_fold_fraction:
            reasons.append("FOLD_STABILITY_TOO_LOW")
        if evidence.median_fold_return < self.config.strategy_lab_min_median_fold_return:
            reasons.append("MEDIAN_FOLD_RETURN_NEGATIVE")
        if evidence.cost_stress_profit_factor is None:
            reasons.append("NO_COST_STRESS_TEST")
        elif evidence.cost_stress_profit_factor < self.config.strategy_lab_min_cost_stress_profit_factor:
            reasons.append("FAILS_COST_STRESS")
        return len(reasons) == 0, tuple(reasons)
