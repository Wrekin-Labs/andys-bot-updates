# R7.6 research notes

Research date: 29 September 2026.

## 1. Crypto microstructure

A 2026 study, *Explainable Patterns in Cryptocurrency Microstructure* (Bieganowski & Ślepaczuk), reports stable cross-asset predictive importance for engineered order-book and trade features including order-flow imbalance, spread and adverse-selection effects, using 1-second crypto data through October 2025. It validates tradability with conservative taker and fixed-depth maker backtests and highlights maker vulnerability during crash conditions.

Source: https://arxiv.org/abs/2602.00776

R7.6 response:
- top-of-book imbalance
- five-level depth imbalance
- microprice shift
- trade-pressure confirmation
- explicit adverse-selection risk
- stale/wide-book fail-closed behavior

## 2. More realistic fill simulation

NautilusTrader's current execution simulation supports trade-based fills, displayed queue-position tracking and liquidity consumption. A resting limit order does not become fill-eligible merely because price touches it; displayed quantity ahead must be cleared by correct-side trades.

Sources:
- https://nautilustrader.io/docs/latest/concepts/backtesting/trade-execution/
- https://nautilustrader.io/docs/latest/concepts/backtesting/data-and-venues/

R7.6 response:
- QueueFillTracker models quantity ahead.
- Marketable quote amounts walk visible depth to estimate VWAP/slippage.
- This is shadow/backtest evidence only; no execution adapter is included.

## 3. Backtest validity

Freqtrade explicitly recommends lookahead-analysis and recursive-analysis because whole-dataframe calculations, future shifts and recursive indicator warm-up can produce unrealistically strong backtests.

Sources:
- https://docs.freqtrade.io/en/latest/lookahead-analysis/
- https://docs.freqtrade.io/en/latest/recursive-analysis/

R7.6 response:
- promotion is based on forward/counterfactual observations, not headline backtest returns alone.
- statistical promotion requires at least 200 observations by default and lower-confidence-bound evidence.
- no R7.6 result can automatically change live execution.

## 4. Coinbase execution and protection

Coinbase Advanced Trade provides REST and WebSocket APIs, dedicated portfolio scoping, and order-management features. Coinbase's changelog documents support for editing attached order configurations, while fill commissions are per fill. This reinforces the need to reconcile actual fills/fees rather than estimate them from order count.

Sources:
- https://docs.cdp.coinbase.com/advanced-trade/docs/ws-overview/
- https://docs.cdp.coinbase.com/coinbase-app/advanced-trade-apis/guides/portfolios
- https://docs.cdp.coinbase.com/coinbase-app/introduction/changelog

R7.6 response:
- transaction-cost analysis separates strategy outcome from fill/fee cost.
- R7.6 does not alter the existing Coinbase execution or attached protection path.

## Promotion rule

The research goal is not "trade more". It is to promote only execution routes whose **net** forward evidence survives costs, regime changes, recent performance checks and uncertainty bounds.
