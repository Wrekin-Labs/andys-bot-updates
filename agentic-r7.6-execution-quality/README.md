# Andy's Bot R7.6 — Execution Quality Research

R7.6 is a **shadow-only** research layer. It is intended to improve the quality of evidence used before any future live promotion; it does not place, preview, cancel or modify orders and cannot arm live trading.

## What it adds

- **Microstructure quality**: spread, top-of-book imbalance, five-level depth imbalance, microprice shift, trade pressure, freshness and an adverse-selection risk score.
- **Queue-aware maker simulation**: a resting limit order tracks displayed quantity ahead; correct-side trades must clear that queue before a simulated fill. This avoids the optimistic assumption that every touched limit order fills.
- **Depth-walk taker simulation**: marketable buys walk visible asks to estimate volume-weighted fill price and slippage instead of assuming the best ask fills the whole order.
- **Transaction-cost analysis (TCA)**: implementation shortfall, fee-inclusive entry cost and signed post-fill markouts so live/shadow execution can be attributed separately from strategy alpha.
- **Stricter statistical promotion**: 90% lower confidence bounds for win rate and mean outcome, recent-sample stability, counterfactual drawdown and regime coverage. Maker routes also require a lower-confidence-bound fill rate.
- **Correlation-aware shadow risk**: candidate exposure is compared with open positions so several highly correlated coins are not mistaken for diversified bets.
- **Edge-drift monitoring**: recent forward outcomes are compared with a longer baseline and raise a shadow alarm when mean performance deteriorates materially.
- **Read-only live TCA daemon**: records observed entry cost plus 1m/5m/15m/60m post-fill markouts from the local API only.
- **Selection-bias audit**: every R7.4 walk-forward fold now records how the in-sample winner ranks against all tried parameter variants on the unseen fold. R7.6 blocks research promotion when the winner repeatedly falls into the OOS bottom half or when trial metadata is missing.
- **Tail-risk robustness**: expected shortfall plus deterministic moving-block bootstrap estimates of 95th-percentile drawdown, loss streaks and a configured equity-floor breach rate, scaled by the research capital fraction.
- **Regime-conditional promotion**: pooled averages cannot hide a mature market regime whose lower-confidence-bound mean or hit rate fails the research threshold.
- **Combined promotion bundle**: statistical significance, selection stability, tail risk and mature-regime performance must all pass before R7.6 reports research promotion readiness.
- **R7.6 shadow overlay**: reads the existing R7.5 candidates plus `/api/live`, adds microstructure evidence and may downgrade shadow readiness. It can never create a candidate or affect the live engine.

## Why these upgrades

Recent crypto microstructure research reports stable predictive importance for order-flow imbalance, spread and adverse-selection features across multiple assets. Modern execution simulators such as NautilusTrader model queue position, trade-based fills and liquidity consumption because simple touch-fill backtests overstate passive execution quality. Freqtrade likewise recommends explicit lookahead and recursive-bias checks before trusting backtests. Recent correlation research also shows crypto relationships are regime-dependent, so portfolio concentration should be measured rather than inferred from ticker count.

## Promotion policy

R7.6 remains research-only until enough forward observations exist. The default statistical guard requires at least 200 observations, positive lower-confidence bounds for hit rate and mean outcome, positive recent performance, acceptable drawdown and at least two observed market regimes. These thresholds are evidence gates, not a profit guarantee.

## Safety invariants

- No order endpoints.
- No transfer capability.
- No live arming.
- No risk-limit changes.
- No automatic promotion from shadow to live.
- Existing Coinbase protection and R7.1/R7.5 live gates remain authoritative.

Run `python self_test.py`, `python self_test_extended.py`, `python self_test_selection_bias.py` and `python self_test_tail_regime.py` before packaging or deployment. GitHub CI compiles the patched R7.4 lab and all R7.6 modules on every relevant pull request.
