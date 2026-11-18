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

### 2026-11-04 · Pattern library: ta_patterns in the Python backend, judged by one ATR bracket

Why: the owner wants accurate detection plus the past performance of the same pattern, from free
tools, with the backend in Python. `ta_patterns` (MIT) is the widest free detector set and passed
our look-ahead test at every candle; no free tool measures pattern performance on crypto, so we
do. It returns only +1/-1/0, so every pattern is judged by the same rule (entry at the completing
close, stop 1 ATR, target 2 ATR, 30 candles; break-even 33%), adjustable per request. Its "chart"
list mixes formations with ~80 short-term/volume event patterns that fire on most candles; those
are a separate kind (`short`) so the Chart shows formations by default. The verdict uses a
Bonferroni-corrected Wilson low end over every pattern x direction tested: on a pure random walk
the uncorrected 95% rule flagged 2 of 146 patterns as edges, the corrected one none. The backend
starts in `backend/` without QuestDB (history cached in memory) and the frontend stays at the
repo root; both moves are separate steps of Phase 1. The in-house browser detectors stay until a
library pattern measures at least as well.

### 2026-11-11 · The Python service owns every rule; the TypeScript detectors are deleted

Why: the owner asked for one rule set behind both the chart (recent candles) and the background
statistics (1–2 years). `tcs.analysis.engine.analyze` is called by both, so a pattern on the chart
is measured by exactly the rules that drew it. The browser keeps display-only computations
(indicators, visible-range volume profile, order-book heatmap) that never feed a statistic.
Supersedes "Phase 1a: analysis runs in the browser" and the `candlestick` package decision.

### 2026-11-11 · SQLite store now, QuestDB with the collector

Why: the statistics job needs stored history today and the owner runs everything with two npm
commands. SQLite (stdlib, one file, WAL) needs no install; `store/sqlite.py` is the only place
that knows it. Revisit: the live collector (klines, funding, OI) lands with QuestDB + Docker
Compose as in ARCHITECTURE; the store interface stays.

### 2026-11-11 · History from Binance's public archive, the tail from REST

Why: `data.binance.vision` serves the same USDⓈ-M klines as monthly/daily zips, free and
unthrottled, so 2 years × 10 coins × 3 timeframes is ~1000 small files instead of thousands of
weighted REST calls; REST only fills the last hours. Where REST is geo-blocked (seen from the dev
sandbox: HTTP 451) the data ends at the last archived day and every response says how many
candles it is behind.

### 2026-11-11 · Frontend stays at the repo root for now

Why: moving `src/` to `apps/web/` touches every path, the CI and the tooling for no behaviour
change. `backend/` sits beside it; the move happens when a second app or the Compose setup needs it.

### 2026-11-11 · Bearish chart patterns are the bullish rule on the mirrored series

Why: one implementation per pattern keeps the two directions identical by construction (a double
top is a double bottom upside down: prices negated, highs and lows swapped; ATR unchanged). A
test asserts the symmetry on random walks and real data.

### 2026-11-11 · Locations: confluence / zone / order block / open space, matched by time

Why: the owner wants zones and order blocks to add confidence; measuring them separately (and the
pattern at any location as a baseline) shows whether a location adds anything instead of
assuming it. Levels must predate the pattern and be intact at confirmation; higher-timeframe
levels are matched by close time, so there is no look-ahead across timeframes.

### 2026-11-11 · TS types generated by our own small script, not openapi-typescript

Why: `openapi-typescript` needs TypeScript 5's compiler API; this repo's TypeScript 7 (native)
ships none (verified: it crashes). `tcs ts-types` (60 lines) covers the JSON-schema features our
Pydantic models use; a pytest fails when `src/api/schema.ts` is stale.

### 2026-11-11 · Liquidity heatmap in the browser from Binance + OKX full depth

Why: it is live visualisation, not a statistic, and the order book already lives in the browser.
Each exchange has its own socket through `BaseWebSocketClient`; Binance uses its documented
snapshot + diff sync, OKX its sequence ids. Buckets are ~50 round steps across the range the books
cover (OKX's 400 levels span only ~$40 either side of BTC: a price-based 5 bps bucket gave two
buckets per side). Liquidity is never used in statistics: visible orders can be spoofed.
Revisit: server-side depth recording when the collector exists, so history survives a reload.

### 2026-11-11 · The single rule set replaces the ta_patterns Pattern library (owner decision)

Why: PR #6 (ta_patterns, 2026-11-04) and PR #7 (this rule set) were built in parallel and both
own `backend/`. The owner chose one rule set: the chart and the statistics must run the same
rules, each pattern keeps its textbook stop and target, and locations (zones, order blocks) are
measured. ta_patterns' uniform 1-ATR/2-ATR bracket and its separate panel next to the browser
detectors were two rule sets at once. Kept from #6: the Bonferroni idea for the verdict is noted
for Phase 2 (ROADMAP), the uv version pin in CI and the JS lint ignoring `backend/`. Its code
stays in git history (`cfb4719`).

### 2026-11-11 · The chart draws key levels only; the filter never touches statistics

Why: owner feedback, too many zones, order blocks and labels. A year of 1d history leaves dozens
of intact levels; drawing them all hides the few price is near. Default: intact, the nearest 2 of
each kind, zones with a departure of at least 2 ATR, overlapping levels merged (stronger kept),
the selected pattern plus 3 recent tags. All adjustable and saved per browser
(`src/utils/overlaySettings.ts`). It is a display filter in TypeScript on purpose: setups are
still located against every level by the Python rules, so the numbers do not depend on it.

### 2026-11-11 · Product name GreenMTM

Owner decision: the product is **GreenMTM** (MTM = mark-to-market), no tagline. Logo: an emerald
tile with an M drawn as a price line whose last leg breaks out upward (`public/greenmtm.svg`,
also the favicon). Code names stay: the Python package is `tcs` and the repo `crypto_dashboard`;
renaming them would touch every import for no user-visible change.

### 2026-11-17 · Delta, CVD and big trades are display data; candles carry taker buy volume

Why: step 1 of the order-flow rebuild (`docs/product/COMPETITORS.md` §4). Binance klines report
the taker buy volume, so delta per candle is exact without downloading every trade; candles now
keep it (`Candle.takerBuyVolume`, `Series.taker_buy`, `/candles` 7th column, mirrored as taker
sell). Delta and CVD are chart indicators in TypeScript and big-trade bubbles a live chart layer:
nothing reads them for a statistic yet. Once an order-flow rule is measured (CVD divergence,
"delta confirms"), it goes into `backend/src/tcs/analysis/` like every rule, with a new
`RULESET_VERSION`. Stores made before this drop their cached candles once (public archive data,
downloaded again with taker volume on the next request); statistics are kept.

### 2026-11-17 · Order flow is measured as context of a setup, not as a setup of its own

Why: the competitor research found no published evidence that order-flow signals predict
anything on their own; the question worth answering is whether they change a setup's record.
So `analysis/flow.py` tags every occurrence (delta with / against / neutral, CVD divergence
yes / no) and the stats job splits pooled records by tag (rule set r2). Per-coin records are not
split: buckets would be too small. The ±2% delta cut was set from the feature's spread on real
ETH 4h (median |ratio| 0.023), not from outcomes. The UI calls a bucket better or worse only when
its whole Wilson range is on one side of the setup's rate, and warns that many buckets are
compared at once (multiple-testing correction is still Phase 2).

### 2026-11-17 · Order-book depth is recorded in the API process, one column per minute

Why: the heatmap lost its history on every reload (step 3 of the order-flow rebuild). The
recorder (`backend/src/tcs/depth/`) runs as asyncio tasks inside the API process rather than a
separate collector: no new process to start, and the QuestDB collector (Phase 1) can absorb it
later. It ports the browser's tested book sync and bucketing, samples every 2 s and stores the
per-minute average (about 1.5 KB per coin per minute, 7 days kept), not every sample, which
would be ~250 MB a day for 10 coins. BTC and ETH are recorded from the start
(`TCS_DEPTH_SYMBOLS`); opening the heatmap on another coin starts recording it too, up to 6
coins (two sockets each), until the process restarts. The browser puts the recorded minutes in
front of its own 2 s samples and adopts the recorded bucket size so both share columns. New
dependency: `websockets` (BSD-3, TOOLING).

### 2026-11-17 · Exchange sockets on port 443, Binance futures split by path

Why: a live run found Binance's futures WebSocket split (March 2026: order-book streams on
`/public`, market streams on `/market`; the old path accepts subscriptions and sends nothing) and
proxies dropping OKX's 8443 and Binance spot's 9443. Both exchanges serve the same streams on
443, so we use 443 everywhere. `BinanceAdapter` keeps its public API (spot / futures) and routes
each stream to its socket internally (`binanceSocketFor`); futures connection state follows the
`/market` socket. Exchanges now connect independently, as the guardrail always required.

### 2026-11-17 · Heatmap: per-snapshot columns, thermal palette, deep book from OKX REST

Why: owner feedback that the heatmap was not industry standard. Bookmap / TradingLite draw one
column per book snapshot behind the price with a thermal palette, auto contrast and a wide price
range; ours averaged per candle, drew over the candles and saw ±$40 of BTC. Now
`utils/heatmapRender.ts` rasterises snapshots into an ImageData buffer (cheap per scroll) on a
canvas under the chart; bids and asks share one colour scale (size is what the colour says; the
depth profile shows the sides). The live sockets stay the source near the price (fresh, exact);
OKX's `books-full` REST (5 000 levels a side) is polled every 5 s for the levels beyond them
(`farBook`), well inside OKX's public rate limit. Binance's REST depth is capped at 1 000 levels,
so it adds nothing beyond its socket.

### 2026-11-17 · Heatmap = the three exchanges added up, within ±2% of the mid

Why: owner asked for aggregate liquidity across the exchanges we support. Binance, OKX and Delta
are summed per price bucket. A shared window of ±2% around the average mid keeps the scale
meaningful: Delta streams its whole book (stray orders at $0.50 and $12M) and each exchange
reaches differently; ±2% covers what a trader reads on a BTC chart and what the deep books fill.
Delta's public socket (`public-socket.…`) refuses order-book channels, so its book comes from
`socket.india.delta.exchange`. Delta is USD-quoted; USD vs USDT differs far less than one bucket,
so its levels are added at face value. The panel shows each exchange's share so a missing
exchange is visible, not silent.

### 2026-11-18 · Patterns drawn after the industry convention; labels flipped for bearish twins

Why: owner review: the selected pattern was a thin blue path among zones, blocks and full-width
price lines, not the clear figure charting tools show. Now the formation is shaded in the
direction's colour with labelled key points, a breakout ring, the measured move and a
TradingView-style position box over the outcome window (the window, not the exit, so the box is
readable when a trade resolves in 1–3 candles; the exit gets its own dot). Other overlays fade
while a pattern is selected. Bearish patterns are found on the mirrored series, so they used to
keep the bullish names ("Low 1" on a double top's highs, "Upper" on the lower line);
`mirroring.py` now flips them. Labels feed no statistic and are not in the golden snapshot, so
this is not a new rule-set version. The box also shows reward / risk at entry, which makes setups
whose target was already passed at entry visible ("Target behind entry"); whether to drop them is
a rule decision left to the owner (ROADMAP parking lot).

### 2026-11-18 · A trailing take-profit is measured next to the fixed target (r3)

Why: owner asked to maximise profit with a trailing TP. Eleven standard exits (fixed 30 / 120
candles, ATR chandelier 2-4, breakeven + trail, trailing TP 0.5-2 ATR, half at target + trail,
swing trail) were compared on the same setups with costs, a random-entry control with the same
exit, and a year-1 pick checked on year 2. "Trailing TP 0.5 ATR" won on daily chart patterns in
both years; it was the best on year 1 and stayed ahead on year 2. It is added as a second outcome
rather than replacing the fixed target, so the existing record stays comparable and the card shows
both. A new exit is a statistics change, so the rule set is r3 and everything is re-measured. The
trail parameter was chosen on year 1 only; the reported year-2 numbers are the honest ones.
