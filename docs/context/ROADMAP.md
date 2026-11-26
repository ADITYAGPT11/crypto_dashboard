# Roadmap: from live dashboard to trade confirmations

Module specs live in `docs/product/modules/`. Each phase ends with something **measurable**.
Tick boxes as work lands; delete finished phases' detail once they're summarised in `STATUS.md`.

```mermaid
flowchart LR
  P0["P0 Stabilise browser app<br/>M1 · M9 🚧"] --> P1["P1 Backend + history<br/>M1 M2"]
  P1 --> P2["P2 Research + backtest<br/>M3"]
  P2 --> P3["P3 Signals<br/>M4 · M9"]
  P3 --> P4["P4 Forward test<br/>M5"]
  P1 --> P5["P5 News impact<br/>M6"]
  P4 --> P6["P6 Risk + confirmations<br/>M7 · M8"]
  P5 --> P6
```

## Phase 0 · Stabilise the browser app (current)

- [x] Fix the runtime crash (`CANDLE_INTERVALS` / `setActiveInterval` undefined in `MainContainer`)
- [x] Fix the remaining type errors (missing imports in `AlertService`/`AlertEngine`,
      `CandleService.fetchCandles` in `ChartPanel`)
- [x] Delete dead files and the unused `@electric-sql/pglite` dependency
- [x] Backend prototype starts (`npm run backend` bundles it) and passes type-check + lint
- [x] Test runner: Vitest via Vite+, 191 tests (master, 2026-10-25)
- [x] CI: GitHub Action (`.github/workflows/ci.yml`) runs check, tests, build and the backend bundle on each PR
- [x] Fix symbol filter dropping JUP/SUPER etc. (`toCanonicalSymbols` in `symbolUtils`)
- [x] Unsubscribe price/funding streams on symbol removal (all three adapters)
- [x] Exchange badge shows `down` after 3 failed reconnects in a row (`utils/connectionState`)
- [x] Label Delta instruments as USD; never mix with USDT silently (spread panel compares USDT only)
- [ ] Verify Delta funding-rate units against the docs (tagged "units unverified" until then)

**Exit:** app loads with no errors; `npm run build` and CI green; STATUS issues 1–5 closed.

> The old module roadmap from `agent-docs/projectNotes.txt` (Modules 0–11) is folded in here:
> 0–6 ≈ done (see STATUS); 7 Telegram → P6 alerts; 8 history/replay → P1 + P2; 9 liquidity
> heatmap and 10 derivatives stats → Parking lot / P2 features; 11 reliability → every phase's exit.

## Phase 1a · Dashboard + Chart workspace in the browser ✅ (2026-11-01)

- [x] Analysis engine in `src/utils/`: volume profile, zones, double bottom / bullish engulfing /
      hammer, outcome resolution, setup statistics with Wilson range and break-even verdict
- [x] `HistoryService` (Binance public REST) + multi-coin scan
- [x] Dashboard (setup scanner, setup performance table, pipeline, watchlist)
- [x] Chart workspace (Lightweight Charts, overlays, setup card, volume levels, zones)
- [x] Pattern stats, Risk calculator, Alerts screens (designs in `docs/product/ux/reference/`)
- [x] Dashboard v2 market overview (bubbles, sentiment, monitor, correlation, liquidations,
      volatility regime, sessions, movers, data health)
- [x] Product name + logo: GreenMTM (`src/brand.ts`, `public/greenmtm.svg`)
- [x] Chart detection settings (simplified 2026-11-21 to one timeframe choice for chart patterns), multi-timeframe overlay,
      background stats per context
- [x] Level source applied to Dashboard and Pattern stats (Alerts use same-timeframe levels)
- [ ] Versioned rule presets (v2 editing, labelled exploratory until tested out-of-sample)
- [x] TradingView-style chart: timeframes, chart types, indicators + panes, drawing tools
- [x] Candlestick patterns in the analysis service (10, both directions; in-house since r5)
- [x] Bull flag and inverse head and shoulders (in-house)
- [x] Triangles (ascending, descending, symmetrical) and wedges; bearish twins of every pattern

## Phase 1 · Backend + history (M1, M2)

- [x] Decide backend stack: Python 3.12 + FastAPI + QuestDB (see DECISIONS, ARCHITECTURE)
- [x] Scaffold `backend/` with uv (FastAPI, tests, CI job) (2026-11-04; rule set 2026-11-11)
- [ ] Monorepo layout per `ARCHITECTURE.md`: move frontend to `apps/web`
- [ ] Collector service: Binance + OKX (+ Delta) via CCXT; health + gap detection
- [ ] `infra/docker-compose.yml`: QuestDB + backend + web
- [ ] QuestDB tables: candles 1m, funding, OI
- [ ] Backfill job: 2 years of the top 20 USDT pairs
- [ ] Data quality report (gaps, dupes, outliers)
- [x] Detectors (deterministic, versioned, unit-tested): candlestick and chart patterns,
      demand/supply zones, order blocks, FVG, BOS/CHoCH (`backend/src/tcs/analysis`)
- [x] Setup history engine: pattern × direction × location → outcome, n, Wilson 95% range,
      break-even, expectancy; per coin and pooled (background job, 1–2 years)
- [ ] Random-entry baseline per setup (same stop/target distances)
- [ ] API: `/candles`, `/indicators`, `/patterns`, `/zones`, `/volume-profile`, `/scanner/now`,
      `/setups`, `/setups/{id}/history`, `/alerts`, `/coverage`, `/quality`, `/backfill`, `/health`
- [ ] Phase 1 UI per `docs/product/ux/PHASE1_UX.md`, in priority order: **Dashboard** (setup
      scanner), **Chart workspace** (Lightweight Charts + indicators, patterns, zones, volume
      levels, setup card), Pattern stats, Risk calculator, Alerts, Research data
- [ ] Server-side setup alerts + Telegram delivery (port from `src/backend/telegramService.ts`)

**Exit:** 7 days of unattended collection; < 0.1 % gaps after backfill; Phase 1 UI acceptance
criteria met.

## Phase 2 · Research + backtest (M3)

- [ ] Feature library (TA, funding percentile, basis, OI change, regime)
- [ ] Multiple-testing correction on the verdict (Bonferroni or FDR across every setup tested;
      from PR #6: on a random walk the uncorrected 95% rule flagged 2 of 146 patterns as edges)
- [ ] Vectorised screener + event-driven backtester with the shared cost model
- [ ] Strategy report generator (HTML) + gate checker
- [ ] Research journal: every hypothesis and result logged, including failures
- [ ] First 3 hypotheses tested (funding extremes, breakout+vol, basis reversion)

**Exit:** ≥ 1 strategy passes the gate in `M3-research-backtest.md`.

## Phase 3 · Signal engine (M4) + UI

- [ ] Strategy runtime shared with the backtester (parity test)
- [ ] Signals table + API; Strategies and Confirmations screens (paper only)
- [ ] Upgrade the spread panel to fee- and USD/USDT-aware basis/spread calculations
- [ ] Add TanStack Query for API data on the new screens (plain `fetch` until then)

**Exit:** live signals match replayed backtest entries 1:1.

## Phase 4 · Forward test (M5)

- [ ] Paper ledger for every signal and veto; drift detection + auto-pause

**Exit:** ≥ 30 forward trades per promoted strategy inside the backtest 95 % band.

## Phase 5 · News impact (M6), can run in parallel after P1

- [ ] Ingest news + calendar + exchange announcements; classify
- [ ] Event-study per category; impact rules

**Exit:** measured improvement (or none) of news filtering, documented.

## Phase 6 · Risk + confirmations (M7, M8)

- [ ] Risk manager with all veto paths unit-tested
- [ ] Calibrated confidence + confirmation cards + alerts (Telegram)
- [ ] Monthly calibration report

**Exit:** confirmations live; calibration within ± 5 %.

## Parking lot (ideas, not scheduled)

- Research harness in the repo (`backend/src/tcs/research/`): the filter and exit studies of
  2026-11-18 (momentum / volume / trend filters, 11 exits, random-entry control, year split) as
  a CLI, so any rule change can be re-measured the same way.
- Owner decision (rule change, new `RULESET_VERSION`): skip setups whose reward / risk is under
  0.5 (2026-11-18 sample: 89 of 453 double bottoms/tops). Targets already passed at entry are
  skipped since r5.
- Order-book features for research: full depth needs snapshot + diff sync (today: top-20 partial book).
- Liquidity heatmap (old Module 9); candidate renderer: nazmiefearmutcu/flowmap (see TOOLING).
- Order-flow toolkit, free rebuild of paid tools (DeepCharts, Bookmap, CoinGlass, LuxAlgo); order and
  method in `docs/product/COMPETITORS.md` §4: delta/CVD + big trades → footprint → recorded heatmap →
  liquidations, OI, estimated liquidation map → absorption / stop-run / iceberg as measured context →
  rule builder + backtester. Supersedes the old Module 10 derivatives-stats idea.
  Step 1 ✅ 2026-11-17 (delta, CVD, big trades on the chart; measured as setup context, r2).
  Step 2 ✅ 2026-11-17 (live footprint layer). Step 3 ✅ 2026-11-17 (depth recorder, heatmap
  history). Next: step 4, liquidations + OI/funding + estimated liquidation map.
- Angel One / Indian equities (removed in `4350c71`).
- Auto-execution, only after Phase 4/6 evidence justifies it.
- Top news panel (needs a source: backend-fetched RSS or a free CryptoPanic key, owner to approve).
- Browser push notifications and quiet hours for setup alerts.
- ML models (gradient boosting on features) as a _filter_ on rule-based signals, never a black box.
