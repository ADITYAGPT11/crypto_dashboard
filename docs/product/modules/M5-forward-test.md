# M5 · Forward test (paper ledger)

**Status:** ⬜ Not started.

## Responsibilities

- Open a paper position for **every** signal, including vetoed ones (tracked separately), so we
  can measure the veto's value too.
- Simulate fills with the same cost model as M3; close on stop, target or expiry.
- Compare live results to the backtest's expected distribution and flag drift.

## Flow

```mermaid
flowchart TB
  SIG["signal from M8<br/>or veto from M7"] --> OPEN["open paper position<br/>fill = next price + slippage"]
  OPEN --> MTM["mark-to-market on every tick"]
  MTM --> EXIT{"stop / target / expiry hit?"}
  EXIT -- no --> MTM
  EXIT -- yes --> CLOSE["close, apply fees + funding,<br/>record PnL in R"]
  CLOSE --> STATS["update strategy live stats"]
  STATS --> DRIFT{"live expectancy outside<br/>backtest 95 % band?"}
  DRIFT -- yes --> FLAG["flag strategy → auto-pause<br/>and notify"]
  DRIFT -- no --> OK["keep running"]
```

## Promotion rule

A strategy may show **confirmations** (not just paper signals) only after its forward test reaches
≥ 30 trades with expectancy inside the backtest's 95 % confidence band.

## Acceptance criteria

- [ ] Every signal has exactly one paper trade record.
- [ ] Drift detection auto-pauses a strategy and the UI shows why.
