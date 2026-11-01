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

### 2026-11-01 · QuestDB for market data + PostgreSQL for app data (approved)
Why: the backend has several processes reading and writing at once (collector, signals, API), so an
embedded single-writer store (DuckDB) doesn't fit as the system of record. QuestDB is columnar,
built for market data, ingests very fast, and has trading-friendly SQL (`SAMPLE BY`, `LATEST ON`,
`ASOF JOIN` for spot/perp and cross-exchange alignment). Its weak spot is mutable relational data,
so signals, paper trades, risk state and config live in PostgreSQL. Both are free to self-host
(QuestDB OSS is Apache 2.0).
Rejected: TimescaleDB alone (simpler, one DB, but clunkier market-data queries); QuestDB alone
with app data as append-only events (viable, more design discipline).
Consequence: DuckDB + Polars stay as a *local research* tool over Parquet exports. Revisit with
ClickHouse only if we store full tick/trade history at billions of rows.

### 2026-11-01 · QuestDB only; PostgreSQL deferred (supersedes the entry above)
Why: fewer moving parts. Phases 1–2 are pure market data. Signals and paper trades are stored as
append-only events in QuestDB (current state via `LATEST ON`), which also gives an audit trail.
Revisit: add PostgreSQL only if append-only app data proves painful in Phase 3.

### 2026-11-01 · One backend process with an in-process event bus; monorepo layout
Why: seconds-level latency budget; one process is simplest to run and debug. Modules communicate
only through Pydantic event models, so the bus can become NATS/Redis (or a module can move to
Rust) without rewriting module logic. Layout: `apps/web`, `backend/src/tcs`, `research/`,
`infra/`. See `ARCHITECTURE.md`.

### 2026-11-01 · TanStack Query deferred to Phase 3
Why: it pays off for request/response data on several screens (reports, history, charts). Phase 1's
UI only reads `/health`, where plain `fetch` is enough. Live ticks never use it.

### 2026-11-01 · Merged master's "AI code" into PR #1; master's code wins conflicts
Why: master gained ~12.8k lines (charts, order book, alerts, backend prototype, tests) while this
PR was open. Owner chose to keep master's code; this PR now only adds docs + the `index.html` fix.
Consequence: the 2026-11-01 removals of the Arbitrage panel, Binance depth stream and small
helpers are **reverted**. Those features are now real (`ArbitrageService`, `OrderBookService`).
The arbitrage panel is an observation (no fees, mixes USD/USDT) until Phase 3 upgrades it.

### 2026-11-01 · One context system: `CLAUDE.md` + `docs/`; `agent-docs/` folded in and deleted
Why: two sets of agent instructions would contradict each other. Kept from `agent-docs/`:
guardrails (no execution, free-first, honest numbers, secrets server-side), the reuse-audit rule
and its table (now in `TOOLING.md`), Vite+ commands, coding conventions, the module roadmap
(mapped into `ROADMAP.md`). Superseded: "TypeScript end-to-end / Node backend" (see next entry).

### 2026-11-01 · TypeScript backend in `src/backend/` is a prototype; Python remains the target
Why: owner confirmed Python + FastAPI + QuestDB after master added an Express + `node:sqlite`
backend. Research and backtesting need Python's libraries.
Consequence: the TS backend is frozen (fix only to keep the build green); its Telegram client and
replay ideas get ported to Python in Phase 1/6, then `src/backend/` is deleted.

### 2026-11-01 · "Never claim an edge" guardrail reconciled with the mission
The old notes said "never claim the tool predicts price or guarantees an edge". The mission is
measured edge with confirmations. Rule now: never *guarantee*; only show edge/confidence that is
measured out-of-sample and forward-tested, with uncertainty, and a human makes every trade.
