# Andy's Bot R7.2 — Evidence-Weighted Trading Edge (Research Spec)

Status: **research / paper / shadow only** until the exact current R7.1 source is patched, tested and reviewed. This document must not alter live Coinbase submission behaviour by itself.

Evidence basis: review pack generated 2026-08-29 08:22 UTC from running bot `5.13.7.0-supervised-live`, plus current Coinbase Advanced documentation and recent 2025–2026 crypto trading research.

## 1. Preserve the safety/execution layer

Do not weaken:
- Coinbase-only live execution.
- Preview -> Approve supervised-live workflow.
- authoritative order ledger and reconciliation.
- unknown-submission blocking.
- price-drift checks and live daily/lifetime loss controls.
- exchange-order protection reconciliation.

R7.2 is primarily a **decision-quality and research-validation upgrade**, not a live-risk increase.

## 2. Current evidence that drives R7.2

Normal paper evidence:
- start £100.00; equity about £98.44.
- 22 closed exits; 7 winners; win rate 31.8%.
- realised P/L about -£1.56.
- logged fees about £0.88; slippage about £0.39.

Exit concentration:
- `ensemble_exit`: about -£1.27 total; only 1/8 profitable in the raw exit summary.
- `hard_stop`: about -£0.93 total; 0/5 profitable.
- `max_hold_time`: about -£0.27 total; 0/3 profitable.
- `partial_profit_1R`: about +£0.34 total; 7/7 profitable.
- `profit_target`: about +£0.52 total; 3/3 profitable.
- `trailing_stop`: slightly positive in the current sample.

Coin concentration:
- DOGE is the largest normal-paper loser (about -£1.12 over 3 completed exits).
- CRV is about -£0.44 over 2 completed exits.
- SOL is positive in the current normal-paper sample, but sample size is too small to justify larger live risk.

Counterfactual blocked-gate evidence does **not** support broad gate relaxation. Approximate positive-after-cost rates when bypassed:
- MULTI_TIMEFRAME: 41.7%.
- COST: 32.0%.
- STRATEGY_CASH: 29.0%.
- EDGE_DECAY: 22.8%.
- PRICE_SANITY: 20.3%.
- REWARD_RISK: 17.3%.

Conclusion: forcing more trades by loosening blockers is not supported by the evidence.

## 3. Confidence calibration redesign

Current calibrated probabilities can materially overstate observed after-cost success. Examples from the review pack:
- SNX: calibrated ~61.3%, observed after-cost hit rate ~17.2% (227 samples).
- ETC: calibrated ~55.1%, observed ~17.2% (227 samples).
- DOGE: calibrated ~44.8%, observed ~20.1% (294 samples).
- SHIB: calibrated ~51.5%, observed ~7.5% (40 samples).
- 1INCH: calibrated ~52.9%, observed 0% (29 samples).

Required R7.2 behaviour:
1. Never use displayed calibrated probability as a sufficient BUY condition.
2. Add `empirical_after_cost_hit_rate` and `calibration_gap = calibrated_probability - observed_after_cost_hit_rate` to every candidate.
3. Add a reliability shrinkage layer toward 50% / global baseline for small samples.
4. A large positive calibration gap must reduce candidate quality, never increase it.
5. Separate calibration by horizon, regime, symbol and strategy where sample size permits.
6. Show confidence intervals / sample counts in the dashboard.
7. Paper-only veto suggestion: if observed after-cost hit rate is below 35% with >=100 independent episodes, mark the symbol/strategy `EDGE_UNPROVEN` regardless of headline probability.

## 4. Strategy Lab validation upgrade

Current `strategy_lab_min_oos_trades = 5` is too permissive for promotion decisions.

R7.2 research targets:
- minimum 30 independent OOS trades before any strategy can be considered promotion-ready.
- at least 5 walk-forward folds where practical.
- purged/embargoed validation to prevent leakage.
- profit factor target >= 1.20 after realistic fees/slippage.
- OOS return > 0.
- full-period return > 0.
- full-period profit factor > 1.0.
- no single fold may account for most of the total profit.
- parameter-stability positive fraction target >= 70%.
- stress test at current authenticated Coinbase fees plus additional slippage/spread shock.
- frozen holdout period not used for parameter tuning.

Important: several current high-scoring strategies are correctly rejected because attractive OOS slices conflict with negative full-period evidence. Examples include SOL/AAVE trend momentum and BTC Donchian breakout. Keep those in research rather than promoting them.

## 5. Regime-aware strategy selection

Recent crypto research supports making momentum conditional on persistent positive regimes rather than applying it unconditionally.

R7.2 regime policy for PAPER/SHADOW validation:
- persistent UP -> momentum/breakout eligible if breadth, cost and calibration checks also pass.
- DOWN or transitional -> momentum disabled or heavily penalised.
- sideways/compression -> research mean-reversion / breakout-watch only; no forced entry.
- weak breadth -> reduce candidate rank and simultaneous correlated exposure.

The BTC regime/breadth module should act as a **capital/eligibility switch**, not just a small score adjustment.

## 6. Cost-aware execution model

Coinbase Advanced fees vary by tier and update with trailing volume. Use the authenticated current fee tier immediately before preview/approval when available.

For each candidate calculate:
- expected gross return.
- expected maker/taker entry cost.
- expected exit cost.
- current spread.
- estimated slippage based on L2 depth and order size.
- expected net return after all costs.
- edge multiple = expected gross edge / all-in round-trip cost.

Research requirement:
- do not qualify a candidate if expected net edge <= 0.
- require a safety margin above all-in cost rather than merely clearing cost by a few basis points.
- compare post-only maker attempt vs immediate taker execution using estimated fill probability and adverse-selection risk.
- never sacrifice protective exit certainty solely to save maker fees.

## 7. Exit-engine redesign

The current evidence says exit losses dominate.

R7.2 paper/shadow experiments:
1. Treat `partial_profit_1R` as a validated hypothesis to continue testing, not proof of future profitability.
2. Rework `ensemble_exit` so a weak model-score reversal alone cannot dump a position after normal noise; require price/structure/order-flow confirmation or a materially degraded expected net edge.
3. Separate `thesis_failure_exit` from generic ensemble change.
4. Test break-even/trailing protection after first partial profit.
5. Re-test maximum hold by horizon/strategy instead of one broad timeout.
6. Log maximum favourable excursion (MFE) and maximum adverse excursion (MAE) for every trade.
7. Use MFE/MAE to determine whether stops are too tight, entries are late, or exits surrender too much profit.

## 8. Coin/strategy throttling

Do not permanently blacklist from tiny samples, but introduce evidence-based throttling.

Paper/shadow rules to test:
- repeated negative expectancy + high sample confidence -> quarantine / research-only.
- small positive sample -> no risk increase; continue observation.
- require improvement in rolling after-cost expectancy before restoring normal eligibility.

DOGE should currently be treated as a priority diagnostic case because both paper outcomes and calibration evidence are weak. SOL should remain research-positive but **not** receive larger live stakes from three wins.

## 9. Portfolio/correlation controls

R7.2 should rank candidates at portfolio level:
- estimate rolling BTC beta/correlation.
- bucket highly correlated altcoins.
- do not consume multiple live/paper slots with near-identical BTC-beta exposure unless the aggregate risk budget explicitly allows it.
- score incremental diversification value when choosing among candidates.

## 10. Market data reliability

Review pack indicates very frequent product resync activity and occasional connection/file-access errors.

R7.2 reliability tasks:
- instrument cause of every L2 product resync; distinguish genuine stale/crossed book recovery from unnecessary refresh loops.
- add per-symbol data-quality score and block research/live candidate use when quality is degraded.
- atomic/append-safe market recorder writes to avoid Windows file-lock failures.
- clean reconnect state so remote monitor reports a known model state after supervisor restarts.

## 11. Version/update consistency

The running review reports `5.13.7.0-supervised-live` and R7.1-era components, while the public updater manifest on 2026-08-29 still advertises `5.13.5.6 R5.8.2 Updater End-to-End Proof`.

Required:
- one authoritative version constant/source.
- engine version, UI version, review-export version and updater manifest must agree.
- updater must refuse a downgrade unless explicitly selected.
- do not publish R7.2 in the updater until exact current source is patched and regression-tested.

## 12. R7.2 dashboard additions

Show at top:
- paper/live/shadow mode clearly.
- current authenticated maker/taker fee tier.
- gross P/L, estimated costs and net P/L.
- regime + breadth state.
- candidate count and why no trade.
- current strategy evidence status.
- calibration probability **and observed after-cost rate + sample count**.

Candidate table fields:
- symbol / strategy / horizon.
- gross expected edge.
- all-in executable cost.
- net edge.
- calibration probability.
- observed after-cost hit rate.
- sample count/reliability.
- regime eligibility.
- portfolio-correlation penalty.
- council verdict.
- explicit blocker list.

## 13. Release gates

R7.2 trading logic remains paper/shadow until all are true:
- regression tests pass.
- no unknown order states.
- updater version consistency fixed.
- at least 30 OOS trades for a strategy under consideration.
- after-cost PF >= 1.20 in OOS and >1.0 full-period.
- stable across folds/parameter variants.
- cost/slippage stress remains acceptable.
- forward paper/shadow window is positive with controlled drawdown.

Only after those gates should supervised-live eligibility be considered. Do not automatically raise the live £/order or exposure limits as part of R7.2.

## 14. External research rationale

- Coinbase Advanced distinguishes maker/taker fees, and fee tiers can update hourly with trailing volume; post-only limit orders can ensure maker treatment if filled.
- 2026 walk-forward BTC research shows naive direction-based systems can lose profitability after transaction costs, while cost-aware entry filters can materially improve economic results.
- 2026 crypto factor research finds naive backtests can materially inflate Sharpe compared with nested walk-forward evaluation with explicit costs.
- 2026 microstructure research finds real predictive information can still be too weak to survive standard retail fees, reinforcing the need for all-in-cost gating.
- 2025 research finds cryptocurrency momentum concentrated in persistent UP-UP regimes rather than being unconditional.

## 15. Immediate implementation order

1. Fix version authority/updater downgrade protection.
2. Add empirical calibration-gap + reliability veto in paper/shadow.
3. Add MFE/MAE and richer exit diagnostics.
4. Rework ensemble exit experiments.
5. Raise Strategy Lab evidence requirements.
6. Add regime eligibility switch.
7. Add maker-vs-taker expected-cost model.
8. Add correlation-aware portfolio ranking.
9. Run fresh walk-forward + cost-stress + forward shadow tests.
10. Only then consider a supervised-live R7.2 release.
