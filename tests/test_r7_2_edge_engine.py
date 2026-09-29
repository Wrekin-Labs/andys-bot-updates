import unittest

from r7_2_edge.engine import (
    Candidate,
    Evidence,
    ExecutionCostSnapshot,
    MarketRegime,
    R72Config,
    R72EdgeEngine,
    StrategyLabEvidence,
)


class R72EdgeEngineTests(unittest.TestCase):
    def test_diagnostics_report_probability_used_by_decision(self):
        engine = R72EdgeEngine()
        candidate = Candidate(
            symbol="BTC-GBP",
            expected_gross_return=0.05,
            model_probability=0.20,
            council_score=90,
            activity_score=90,
            reward_risk=2.0,
        )
        evidence = Evidence(
            model_probability=0.80,
            observed_after_cost_hit_rate=0.80,
            samples=200,
        )
        regime = MarketRegime(
            btc_state="UP",
            btc_return_24h=0.02,
            btc_above_ema20=True,
            breadth_state="STRONG",
            breadth_score=80,
        )
        decision = engine.evaluate(
            candidate,
            evidence,
            regime,
            symbol_metrics={"closed": 20, "wins": 15, "pnl_gbp": 5.0},
        )
        self.assertEqual(decision.diagnostics["model_probability"], 0.80)
        self.assertEqual(decision.diagnostics["candidate_model_probability"], 0.20)

    def test_execution_cost_snapshot_overrides_fallback_without_double_counting(self):
        engine = R72EdgeEngine(R72Config(cost_safety_multiplier=1.0))
        candidate = Candidate(
            symbol="BTC-GBP",
            expected_gross_return=0.02,
            model_probability=0.8,
            order_style="taker",
            execution_costs=ExecutionCostSnapshot(
                preview_entry_commission_rate=0.001,
                exit_fee_rate=0.002,
                entry_spread_bps=1,
                exit_spread_bps=2,
                entry_slippage_bps=3,
                exit_slippage_bps=4,
                source="test_preview",
            ),
        )
        breakdown = engine.cost_breakdown(candidate)
        self.assertAlmostEqual(breakdown["round_trip_cost"], 0.004)
        self.assertEqual(breakdown["source"], "test_preview")

    def test_stop_distance_risk_sizing_caps_stake_by_planned_loss(self):
        engine = R72EdgeEngine(
            R72Config(
                max_order_gbp=100.0,
                risk_budget_per_trade_gbp=1.0,
                min_stop_distance_fraction=0.001,
            )
        )
        stake, reasons = engine.risk_based_max_stake(0.02, 0.0)
        self.assertAlmostEqual(stake, 50.0)
        self.assertIn("STOP_RISK_SIZING_ACTIVE", reasons)

    def test_daily_and_peak_drawdown_circuit_breakers_block_new_entries(self):
        engine = R72EdgeEngine(
            R72Config(
                max_daily_loss_gbp=5.0,
                max_peak_drawdown_gbp=10.0,
            )
        )
        blocked, reasons = engine.entry_circuit_breaker(
            daily_pnl_gbp=-5.0,
            equity_gbp=90.0,
            peak_equity_gbp=100.0,
        )
        self.assertTrue(blocked)
        self.assertIn("DAILY_LOSS_CIRCUIT_BREAKER", reasons)
        self.assertIn("PEAK_DRAWDOWN_CIRCUIT_BREAKER", reasons)

    def test_strategy_lab_profit_factor_requires_1_20(self):
        engine = R72EdgeEngine()
        base = dict(
            oos_trades=30,
            max_drawdown=0.05,
            positive_folds=4,
            total_folds=5,
            median_fold_return=0.01,
            cost_stress_profit_factor=1.10,
        )
        ok, reasons = engine.qualify_strategy(
            StrategyLabEvidence(profit_factor=1.19, **base)
        )
        self.assertFalse(ok)
        self.assertIn("PROFIT_FACTOR_TOO_LOW", reasons)

        ok, reasons = engine.qualify_strategy(
            StrategyLabEvidence(profit_factor=1.20, **base)
        )
        self.assertTrue(ok)
        self.assertEqual(reasons, ())


if __name__ == "__main__":
    unittest.main()
