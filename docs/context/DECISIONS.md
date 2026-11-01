# Decision log

Append-only. One entry per non-obvious choice: date · decision · why · consequence.

### 2026-11-01 · Context lives in `CLAUDE.md` + `docs/context/`
Why: AI sessions start cold; a small, curated map beats re-reading the repo each time.
Consequence: every behaviour change updates `STATUS.md`; structure changes update `PROJECT_MAP.md`.

### 2026-11-01 · Mind map as Mermaid in Markdown
Why: GitHub renders Mermaid natively — free, no tool to install, diffable, lives next to the code.
Consequence: `docs/context/MINDMAP.md` is the mind map; edit it like any other doc.

### 2026-11-01 · Removed the Arbitrage panel until a real spread engine exists
Why: nothing produced arbitrage events, so the UI showed a false "no opportunities" result. A
trading system must not display confidence it doesn't have.
Consequence: re-add in ROADMAP Phase 3, fed by fee- and USD/USDT-aware spread logic.

### (earlier) · Each exchange connects independently, subscriptions queued until open
Why: Delta's flaky handshake was blocking data from the other exchanges (commit `a605ed9`).

### (earlier) · Per-cell pub/sub store instead of React state for prices
Why (inferred from the code): tick-rate updates re-rendering the whole table would be too slow; `LiveMarketDataService` +
hooks re-render only the affected `PriceCell`.

### 2026-11-01 · Product docs: one spec per module in `docs/product/modules/`
Why: lets a session load only the module it's working on; flowcharts in Mermaid render on GitHub.

### 2026-11-01 · Backend in Python 3.12 + FastAPI, frontend stays React/TS (approved)
Why: research/backtest/statistics libraries (vectorbt, NautilusTrader, statsmodels, arch,
QuantStats) are Python-first; one server-side language for collector, research, signals and risk
keeps the M3↔M4 code-parity requirement achievable.
Not HFT: the product is research-driven with human execution (minutes-to-days holding), so the
latency budget is seconds. Escape hatch: modules talk via language-neutral messages/schemas, so a
latency-critical hot path (market data, execution) can be rewritten in Rust later if forward
tests prove latency costs money.

### PROPOSED · DuckDB + Parquet as the first data store
Why: embedded, zero-ops, fast analytical scans. Revisit if we need concurrent remote writers.
Status: **awaiting owner approval**.
