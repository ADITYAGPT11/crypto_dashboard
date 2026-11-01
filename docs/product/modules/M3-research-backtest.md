# M3 · Research & backtest engine

**Status:** ⬜ Not started. This module decides what "edge" means for the whole product.

## Responsibilities
- Feature/indicator library: TA (trend, momentum, volatility), funding, basis, OI change, volume
  profile, regime labels.
- **Fast screening** (vectorised) to explore many ideas cheaply.
- **Realistic validation** (event-driven) with fees, slippage, funding, latency and partial fills.
- Statistical gate that a strategy must pass before M4 may run it.

## Research pipeline

```mermaid
flowchart TB
  H["Hypothesis<br/>written down first"] --> F["Build features<br/>from M2"]
  F --> SCR["Vectorised screen<br/>in-sample only"]
  SCR --> P1{"promising after costs?"}
  P1 -- no --> LOG["log result in research journal"]
  P1 -- yes --> ED["Event-driven backtest<br/>fees · slippage · funding"]
  ED --> WF["Walk-forward / OOS test"]
  WF --> ROB["Robustness<br/>param ±20 %, other symbols,<br/>Monte Carlo trade shuffle"]
  ROB --> GATE{"Passes gate?"}
  GATE -- no --> LOG
  GATE -- yes --> REP["Strategy report<br/>versioned + frozen params"]
  REP --> M4["approved for M4<br/>+ M5 forward test"]
```

## The gate (initial thresholds, tune later)
| Metric (out-of-sample, after costs) | Minimum |
| --- | --- |
| Trades | ≥ 100 |
| Expectancy | > 0.15 R |
| Profit factor | > 1.3 |
| Max drawdown | < 20 % at the proposed risk per trade |
| Walk-forward windows profitable | ≥ 60 % |
| Param sensitivity (±20 %) | still profitable |
| Deflated Sharpe / multiple-testing check | p < 0.05 |

## Strategy report contents
Equity curve, drawdown curve, trade list, monthly returns, stats table (win %, avg win/loss,
expectancy, PF, Sharpe, Sortino, Calmar, MAR), performance by regime and symbol, cost breakdown,
and the frozen parameter set with a git hash.

## Acceptance criteria
- [ ] Same strategy code runs in backtest (M3), paper (M5) and live signals (M4), with no rewrites.
- [ ] A backtest of a known strategy matches a hand calculation on a small fixture dataset (test).
- [ ] Every report is reproducible from (data snapshot, params, code hash).
