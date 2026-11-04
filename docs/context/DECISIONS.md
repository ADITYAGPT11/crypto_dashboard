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
Consequence: DuckDB + Polars stay as a _local research_ tool over Parquet exports. Revisit with
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
measured edge with confirmations. Rule now: never _guarantee_; only show edge/confidence that is
measured out-of-sample and forward-tested, with uncertainty, and a human makes every trade.

### 2026-11-01 · Phase 1 UX: confirmation desk, evidence-first, "research instrument" look

Why: a first draft (friendly market watcher, aurora hero) did not match the mission. The owner
chose a redesign organised around the confirmation pipeline even before confirmations exist, where
every probability shows n and a 95% range, styled like the first UX canvas (flat dark terminal:
Inter + JetBrains Mono, blue accent, solid bordered cards, top nav) so all phases share one look.
Glass only on the sticky top bar and overlays; parallax only as a faint Desk header, off under
reduced motion.
Consequence: `docs/product/ux/PHASE1_UX.md` + prototype are the reference for Phase 1 UI. Phase 1
gains a base-rate study engine (pure statistics on stored data) and a risk calculator. Later
phases light up pipeline stages in the same shell.

### 2026-11-01 · Phase 1 priority: setup-scanner dashboard and chart workspace first

Why: owner wants a dashboard followed by TradingView-style charts with indicators, pattern
detection, demand/supply zones, key volume levels and the history of each setup ("occurred N
times, moved X%, won Y%"), on the thesis that bullish patterns in demand zones win more often.
Consequence: Phase 1 gains detectors and a setup-history engine. A setup is pattern + location;
every win rate is shown with n and a Wilson range, per coin and pooled across 20 coins, because
small per-coin samples (e.g. 4 of 5) cannot support confidence alone. Phase 1 numbers are gross;
Phase 2 re-tests edge candidates with costs out-of-sample. Charts use Lightweight Charts, not the
paid TradingView Charting Library. The visual language keeps the first canvas's style with modern
detailing (gradient-edged feature cards, frosted chart toolbar, hover lift).

### 2026-11-01 · Phase 1a: analysis runs in the browser on Binance public history

Why: the owner wants the Dashboard and Chart workspace now; the Python backend and QuestDB are
not built yet. Detectors and statistics are pure TypeScript in `src/utils/` (unit-tested), fed by
`HistoryService` (Binance USDⓈ-M REST, ~3,000 closed candles per coin, 10–12 coins).
Consequence: limited history means many setups show "too few cases". In Phase 1b the same logic
is ported to Python and runs on stored history; the TS versions remain the reference and tests.

### 2026-11-01 · Verdict compares the win rate with break-even, not 50%

Why: setups have different reward-to-risk. A 1.5R target breaks even at 40%, a measured-move
target may need 65%. "Edge candidate" = n ≥ 30 and the Wilson 95% lower bound above the setup's
break-even win rate (from its average win in R).

### 2026-11-01 · Frozen `src/backend` excluded from the app's type-check and lint

Why: it is Node code with its own unresolved errors and is replaced in Phase 1b; type-checking it
with the browser app blocked `npm run build`.

### 2026-11-01 · Backend prototype back under type-check and lint; started via a bundle (supersedes the exclusion above)

Why: the owner asked for every type and lint issue fixed. `tsconfig.backend.json` (Node types) is
part of `tsc -b`, and lint covers `src/backend`. Node can't run the extensionless imports the
backend shares with the app, so `npm run backend` bundles it with `vp build --ssr` into
`dist-backend/` (express stays external) and runs that. No new dependencies.

### 2026-11-02 · Setup alerts run in the browser until Phase 1b

Why: the owner wanted the Alerts screen now and the Python backend isn't built. Rules and firings
live in localStorage; `SetupAlertService` checks every minute while a tab is open and fires only
on candles closing after a rule was saved, once per occurrence, carrying the pooled record.
Telegram goes through the existing Node prototype via a dev-only Vite `/api` proxy (no CORS, no
secrets in the browser). Consequence: no alerts with the browser closed; Phase 1b moves rules and
checking server-side.

### 2026-11-02 · Delta prices stay on the asset's row, tagged USD, and are left out of spreads

Why: Delta India perpetuals are USD-quoted (BTCUSD). Splitting them into BTC-USD rows would hide
them from the watchlist rows people use; comparing them with USDT prices would mix in the
USDT/USD rate. `GenericMarketData.quote` carries the quote; the price cell shows "USD" and
`ArbitrageService` compares USDT prices only.

### 2026-11-02 · Risk calculator sizes on the stop before fees, then states fees

Why: traders size positions on the distance to the stop; fees are shown on top ("loss at stop incl.
fees") and in the break-even win rate rather than silently shrinking the size.

### 2026-11-02 · Dashboard sentiment shows separate gauges, never one combined score

Why: honest numbers. A blended "sentiment 72/100" would imply predictive value nobody has measured.
Each gauge (Fear & Greed, funding, long/short, OI change, breadth, BTC dominance) is shown with
its source and time. A combined score can come later only with a backtest behind it.

### 2026-11-02 · Dashboard overview limited to the 10 research coins

Why: the owner asked for 10 coins. It keeps REST usage small (2 bulk calls every 30 s, 20
per-coin calls every 5 min) and matches the coins the setup statistics pool across.

### 2026-11-03 · Detection timeframes are separate from the chart's view timeframe

Why: the owner asked for it, and a pattern is defined by the candles it is found on, not by what
is on screen. Each (pattern timeframe, zone timeframe) pair is its own setup with its own
statistics, so choosing them never tunes a rule; the rules stay preset v1. Higher-timeframe zones
count only if their impulse candle had closed before the pattern began and their break (if any)
closed after the pattern confirmed. On a lower view the signal is drawn at the higher candle's
close, never earlier. Editable rule versions (v2) come later, labelled exploratory.

### 2026-11-03 · Candlestick patterns: TA-Lib in the backend, not talib-web in the browser

Why: the owner approved `talib-web`, but the audit found it unusable: its wrapper misreads integer
outputs and its wasm never runs `TA_Initialize`, so most candlestick functions can't fire. It was
uninstalled before any code shipped. Our two browser detectors stay until Phase 1b, when the
official TA-Lib (`ta-lib-python`) and `smart-money-concepts` run server-side. Chart patterns
(double bottom, H&S, flags) stay in-house: no maintained permissive library exists; GPL code is
reference only.

### 2026-11-03 · TradingView-style chart: Lightweight Charts + free packages, not a chart rewrite

Why: the owner wants TradingView's features and usability with free tools only. Lightweight
Charts (TradingView's open-source library) stays, so our multi-timeframe pattern and zone overlay
keeps working; indicators come from `indicatorts` (MIT), drawings from
`lightweight-charts-drawing` (MIT), both audited and pinned. KLineChart was the alternative but
meant rewriting the chart and overlay. Indicator values use closed candles only.

### 2026-11-03 · Candlestick shapes from the `candlestick` package, context and plan stay ours

Why: reuse over maintenance. The package (MIT) checks each shape; we add what it leaves out and
what makes a setup measurable: the signal on the pattern's last candle (no look-ahead; tested by
prefix invariance), a minimum size in ATR, a prior decline for reversal patterns, and the
stop/target. Piercing line and morning star are left out: both need price gaps, which 24/7 crypto
rarely has.

### 2026-11-03 · Bull flag and inverse head and shoulders are written in-house

Why: no maintained, permissively licensed library detects them with defined entry, stop and
target (GPL scanners are reference only). Rules are ATR-scaled like the double bottom, use swing
points only once confirmed, and set measured-move targets: inverse H&S stop below the right
shoulder, target neckline + head depth (sloped neckline allowed); bull flag stop below the flag,
target breakout + pole. A wick above the flag doesn't cancel it; a close above the pole top before
the flag forms means the pole is still running.
