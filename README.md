# andys-bot-updates

## R7.2 safety/performance hardening

Branch: `r7-2-safety-performance-hardening`

This branch is **research / paper / shadow only**. It must not be deployed to live trading until the R7.2 release gates are independently satisfied.

Implemented hardening:
- execution-cost snapshots can use observed/previewed entry commission, exit fee, spread and slippage with safe configured fallbacks;
- stop-distance-based risk sizing helpers cap stake by planned loss without raising existing notional limits;
- optional daily-loss and peak-drawdown entry circuit breakers;
- Strategy Lab minimum after-cost profit factor aligned to **1.20**;
- diagnostics now report the model probability actually used by the evidence engine, while preserving the candidate probability separately;
- unit tests and branch CI for the research engine.

No credentials, Coinbase order submission code, updater manifest, live risk limits, or Smashroom Studio deployment are changed by this branch.

### Validation before any live consideration

Keep R7.2 paper/shadow-only until:
1. unit/regression tests pass;
2. execution-cost telemetry is reconciled against real preview/fill records;
3. stop-risk sizing is stress-tested for gaps/slippage;
4. after-cost OOS profit factor is at least 1.20 with stable walk-forward folds;
5. a forward paper/shadow window remains positive with controlled drawdown;
6. version/updater consistency is fixed and independently reviewed.

These changes improve measurement and risk control; they do **not** guarantee profit.
