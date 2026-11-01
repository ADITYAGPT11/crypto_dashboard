# M9 · Dashboard UI

**Status:** 🚧 Live price/funding table exists (this repo, React 19 + Vite+). Everything else is planned.

## Screens

```mermaid
flowchart LR
  NAV["Header nav"] --> MK["Markets<br/>✅ live prices · funding"]
  NAV --> CF["Confirmations<br/>⬜ active cards + history"]
  NAV --> ST["Strategies<br/>⬜ reports · live vs backtest"]
  NAV --> RS["Research<br/>⬜ charts · event studies"]
  NAV --> RK["Risk<br/>⬜ exposure · limits · kill switch"]
  NAV --> HL["System health<br/>⬜ streams · gaps · lag"]
  MK --> CH["Symbol chart<br/>⬜ candles + funding + OI"]
  CF --> DET["Confirmation detail<br/>evidence · rationale"]
```

## Rules
- The frontend reads from the backend API once Phase 1 lands. Direct exchange sockets in the
  browser stay for the Markets screen only, or are dropped.
- Charts: TradingView **lightweight-charts** for price; one charting library for stats.
- Never show a number that isn't backed by data (see the arbitrage-panel removal in DECISIONS).

## Acceptance criteria
- [ ] Confirmations screen shows card, evidence links and status (active/hit/stopped/expired).
- [ ] System health screen shows per-stream state and last message age.
