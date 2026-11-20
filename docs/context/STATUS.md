# Project status

_Last verified: 2026-11-18 · branch `claude/eager-bohr-2rpt9a`_

## Phase

**Phase 1b started: the Python analysis service owns every rule.** Pattern detection, zones,
order blocks, outcomes and statistics run in `backend/` (Python 3.12, FastAPI, TA-Lib, SQLite).
The chart asks it for the recent candles' analysis (refetched after every candle close); a
background job measures every setup over one to two years of the research coins with the same
code. The browser draws, streams live candles and order books, and sizes trades. No
confirmations yet (by design).

## Next up (todo pointer, details in `ROADMAP.md`)

0. Owner: run `npm start` where Binance and OKX are reachable and check the depth recorder goes
   live (`/api/v1/depth/BTC-USDT` feeds) and the heatmap keeps its history after a reload; run the
   r2 statistics on 1h and 1d. Then order-flow step 4: liquidation feed, OI/funding panels and
   the estimated liquidation map (`COMPETITORS.md` §4).
1. Owner: run `npm start` on a machine that reaches Binance, let the first
   statistics run finish (about 15 min for 10 coins × 3 timeframes × 2 years), and review the
   rule set in `docs/product/patterns.md`.
2. Server-side setup alerts + Telegram in Python (replace the Node prototype's role).
3. QuestDB collector (live klines, funding, OI) replacing the SQLite store; Docker Compose.
4. Random-entry baseline per setup (does a pattern beat chance with the same stop/target?).
5. Verify Delta funding-rate units (docs site unreachable from the dev sandbox).

## Health

Verified 2026-11-11 (test counts 2026-11-17):

| Check                                                            | State                                                                                                                                                                                                       |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check` (`vp check`: format + lint + types)              | ✅                                                                                                                                                                                                          |
| `npm test`                                                       | ✅ 348 tests, 35 files                                                                                                                                                                                      |
| `npm run build` (`tsc -b` app + node + backend, then Vite)       | ✅ chart code in its own chunk                                                                                                                                                                              |
| `npm run api:check` (ruff format + lint, pyright strict, pytest) | ✅ 121 tests (invariants on every detector, per-clause rules, golden snapshot, API, generated TS types)                                                                                                     |
| `npm run api`                                                    | ✅ :8000; stats job on 3 coins × 1 year × 1h/4h/1d from the archive in ~17 s                                                                                                                                |
| `npm start`                                                      | ✅ starts web, api and the Node prototype with prefixed logs; Ctrl+C stops all three; finds uv off PATH (`~/.local/bin`, `~/.cargo/bin`) and prints the install command when it is missing                  |
| `npm run dev` + `npm run api`                                    | ✅ Chart, Pattern stats, Dashboard, Alerts, Risk in headless Chromium at 1440 px and 400 px: no app errors, no sideways scroll (Binance blocked in the sandbox: candles via the service's archive fallback) |
| Liquidity heatmap                                                | ✅ with a real OKX book replayed through a mocked socket; ❌ not exercised live (Binance geo-blocked, OKX WebSocket port 8443 blocked in the sandbox)                                                       |

## What exists

- **Analysis service** (`backend/src/tcs/`, `npm run api`): `analysis/` the rule set
  (`engine.analyze` is the single entry point; catalogue and `RULESET_VERSION` in `catalog.py`;
  rules written out in `docs/product/patterns.md`); `jobs/stats_job.py` background statistics;
  `marketdata/` Binance REST + `data.binance.vision` archive backfill; `store/sqlite.py`;
  `api/` FastAPI `/api/v1/{health,patterns,candles,analysis,stats,stats/setup,stats/run,scanner,depth}`; `depth/` order-book recorder.
  `src/api/schema.ts` is generated from it (`npm run api:types`; a test fails when stale).
- **Chart** (`/chart/:symbol`): TradingView-style (timeframes, chart types, indicators, drawings,
  live forming candle) plus the service's patterns, the selected one drawn after the industry
  convention (shaded W / M, H&S, triangle, wedge or flag box, key-point tags, breakout ring,
  measured move, position box over the outcome window; other overlays fade), demand/supply zones, order blocks, fair value gaps, volume profile and a
  **liquidity heatmap** layer with a pools table. Only **key levels** are drawn (Overlays →
  Display settings, saved per browser): intact, nearest 2 of each kind, zones ≥ 2 ATR departure,
  overlaps merged; fresh-only, broken levels, labels and the number of pattern tags are options. Detection settings per pattern (from the
  catalogue) and level source. Setup card: pooled record, the pattern's any-location baseline,
  this coin only, last cases across coins, plan, context checks.
- **Pattern stats** (`/stats`): every pattern × direction × location on 1h/4h/1d with a level
  source and location filter, per-coin breakdown, run progress.
- **Dashboard** (`/`): market overview (unchanged), scanner from the service (last 3 closed
  candles), top setups by cases, watchlist.
- **Risk** (`/risk`) and **Alerts** (`/alerts`): records from the service; alert rules match
  scanner results (same-timeframe levels); old stored rule keys are upgraded.
- **History** (`HistoryService`): Binance REST from the browser, falling back to the service's
  stored candles.
- **Markets** (`/markets`) and the **Node prototype** (`src/backend/`, Telegram) are unchanged.

## Known issues

1. **Binance REST (and spot WebSocket) refuse the dev sandbox's region** (HTTP 451, Binance's
   own geo rule; no network setting fixes it). Everything else is verified live there since
   2026-11-17: Binance futures WebSockets, OKX, Delta, CoinGecko, alternative.me. So in the
   sandbox candle history comes from the archive (up to a day behind), Binance's book cannot sync
   (no snapshot) and funding / OI / 24h volume show "–". Where Binance REST is reachable none of
   this applies.
2. **Statistics need a first run**: until the background job finishes (minutes), Pattern stats,
   the setup card and the scanner show "not measured yet".
3. **Setup alerts run in the browser** (every minute while a tab is open) and use same-timeframe
   levels; Telegram still goes through the Node prototype (`npm run backend`).
4. **Statistics are in-sample** (after estimated costs since r4); Phase 2 adds out-of-sample
   tests. Funding for the current month is estimated where Binance REST is refused (the archive
   publishes whole months). Many setups have too few cases per bucket on 1d.
5. **Order-book depth**: Binance (1 000 levels, socket) + OKX (400 live, 5 000 from REST every
   5 s) + Delta (whole book every ~3 s) are added up within ±2% of the mid. Delta is USD-quoted
   and added at face value (USD ≈ USDT, inside one bucket). Heatmap history comes from the analysis
   service's recorder (BTC, ETH, and coins opened with the heatmap on, 7 days); without the
   service it starts when the page opens. The recorder ran live on OKX in the sandbox (800 levels,
   one column a minute); Binance's half needs REST for its snapshot (see issue 1).
6. Delta funding-rate units unverified; Delta prices are USD-quoted (tagged, left out of spreads).
7. `.idx/dev.nix` lists Svelte/Vue extensions; the Markets page's price-rule alerts are separate.

## History

- 2026-11-20: **"After the pattern" is the main view (rule set r5)**: every setup is also
  followed with a Supertrend (10, 3) from entry until it flips (no target, not tuned), and
  compared with the same ride from random candles of the same coins. The setup card leads with
  "moved the favourable way", average / typical move, best point and length, each next to
  random; the stop / target record is collapsed under "Trade plan"; Pattern stats opens on the
  "After the pattern" view (filters: beats random / no better / too few); the chart draws the
  ride (violet step line). Finding: most patterns move no better than random candles; on 1h the
  bull flag and inverse H&S beat random before costs (`patterns.md → Ride study`).
- 2026-11-18: **Costs in every statistic (rule set r4)**: fees (0.05% a side), slippage (0.025%
  a side) and the funding actually paid (Binance funding history, new `funding` table) are
  charged to each case in R; expectancy, break-even and the verdict are after costs, gross kept
  alongside; the trailing record too. Every page that shows a record now shows it after costs;
  the setup card shows gross, the cost per trade and the cost model. Effect (10 coins × 2 years):
  median cost 0.14 R a trade on 1h, 0.06 on 4h, 0.03 on 1d; 4h fixed-target edge candidates 1 →
  0; on 1d the bear flag stays an edge candidate (+0.67 R after costs, trailing +0.75 R).
- 2026-11-18: **Trailing take-profit exit (rule set r3)**: every setup is also resolved with a
  trailing TP (at the target the stop follows the best price by 0.5 ATR, 120-candle cap); the
  statistics job stores its expectancy with a 95% range next to the fixed exit; the setup card
  shows it and each recent case's trailing R; the chart draws the trailing stop (amber step
  line), where it started and where it closed. Chosen in a walk-forward study over 10 coins × 2
  years (`patterns.md → Exit study`): +0.33 R net per trade on daily chart patterns vs +0.16 R for
  the fixed target (year 2: +0.22 vs +0.10), but random entries gain as much, and 1h / 4h /
  candlesticks stay negative after costs. Statistics remain gross and in-sample.
- 2026-11-18: **Chart patterns drawn to industry standard** (owner review): the selected pattern
  is shaded in green (long) or red (short) with its neckline or trendlines, tags B1/B2, T1/T2,
  LS/H/RS, a breakout ring, the measured move and a TradingView-style position box (target /
  stop, R:R, outcome, exit dot); zones, blocks and the volume profile fade while it is selected;
  Entry / Stop / Target stay as axis labels only; candlestick picks zoom to ~60 candles. Fixed:
  bearish twins kept the bullish labels (a double top's highs named "Low 1", a triangle's lower
  line "Upper"). Verified on real BTC / ETH / SOL 4h in headless Chromium, all 22 pattern kinds.
  Found, not changed (rule decision, ROADMAP parking lot): 12 setups whose target was already
  behind the entry count as wins at negative R.
- 2026-11-17: **Heatmap aggregates all three exchanges** (owner): Delta Exchange India's book
  (`l2_orderbook` full snapshots on `socket.india.delta.exchange`, contract size from its public
  API) joins Binance and OKX in the browser and the recorder. Liquidity is added up within ±2% of
  the mid (Delta's book includes stray orders at $0.50 and $12M); the panel shows each exchange's
  state and share of the liquidity. Fixed: OKX's deep book was trimmed against every live book
  (Binance's wider book could hide OKX levels); now only against OKX's own. Verified live: OKX 48%
  - Delta 52% (Binance geo-refused in the sandbox).
- 2026-11-17: **Liquidity heatmap redrawn to industry standard** (owner feedback): one column per
  book snapshot on the time axis instead of an average per candle; its own canvas behind the
  candles; thermal palette (navy → blue → cyan → green → yellow → orange → red → white) for
  bids and asks together; contrast from the cells on screen (Display settings: low / normal /
  high); current book as a depth profile at the right edge; 120 price rows (was 50, server
  recorder too). Depth: OKX's full REST book (5 000 levels a side, every 5 s) fills the levels
  beyond the live 400, so the heat reaches about ±1.2% on BTC and ±3% on ETH instead of ±$40;
  the recorder stores the same. Verified live on OKX in the browser.
- 2026-11-17: **Live data fixed and verified against the real exchanges** (network access added
  for the remaining hosts). Found by the live run: (1) Binance split its futures WebSockets in
  March 2026 (`/public` for depth and bookTicker, `/market` for aggTrade, kline, markPrice,
  forceOrder); the old `/stream` path stayed open but sent nothing, so live candles, trades,
  funding and liquidations from Binance were silently empty everywhere. `BinanceAdapter` now runs
  a socket per path and routes each stream; the heatmap, recorder and liquidation feed use the new
  paths. (2) A Binance socket that never opened held up OKX and Delta (`connectExchanges` awaited
  each in turn); they now connect independently. (3) OKX and Binance spot moved to port 443
  (8443 / 9443 are dropped by many proxies). Verified in the browser with no mocks: live candle,
  big trades (real 99th-percentile cut ≈ $130K on BTC), footprint, delta/CVD, OKX heatmap,
  Fear & Greed, BTC dominance; the recorder wrote live OKX columns.
- 2026-11-17: **Heatmap history survives a reload**: the analysis service records Binance + OKX
  perpetual books (`tcs/depth/`, same sync and bucketing as the browser, 2 s samples averaged
  per minute, 7 days) for BTC and ETH and any coin the chart opens with the heatmap on (≤ 6);
  `/api/v1/depth/{symbol}`. The chart loads 6 h of recorded minutes ahead of its live samples
  (pools' "for" spans the reload). Tested with fake sockets end to end; new dependency
  `websockets` (BSD-3).
- 2026-11-17: **Footprint layer** (Overlays → Footprint): live Binance perp trades since the page
  opened, binned per view bar and price row (about 12 rows per typical candle, nice step):
  aggressive sells × buys as numbers when zoomed in, delta-coloured cells when not, 3× diagonal
  imbalances, point of control, bar delta. Raw trades kept per symbol for the session (≤ 300k) so
  a timeframe change rebuilds it. Verified with a mocked Binance socket. Display only.
- 2026-11-17: **Rule set `2026.11-r2`: order-flow context measured** (`analysis/flow.py`): at each
  setup's confirmation, delta over 3 candles (with / against / neutral at ±2% of volume) and CVD
  divergence over 2 × 10 candles, written once for longs and mirrored for shorts. The stats job
  keeps pooled records per context; `/stats?context=`, setup detail `contexts`, occurrence and
  case `flow`. Setup card has an Order flow section (now + each bucket vs the setup's rate);
  Pattern stats has an Order flow filter. First run (4h, 10 coins, 2 years, archive data): over
  every setup pooled, delta with the trade won 40.3% (38.5–42.2%) vs against 34.4% (32.5–36.3%),
  CVD divergence 41.1% vs 36.9% without; expectancy stays negative in every bucket, and per
  setup 1 of 61 measurable buckets differs from its setup (chance level). Golden fixture now
  carries taker volume (same prices, checked against the archive).
- 2026-11-17: **Order flow on the chart (step 1)**: Volume Delta and CVD indicators (Binance taker
  buy volume from klines, live on the forming candle, blank where the source has none) and a
  **Big trades** layer (Overlays): Binance perp taker orders merged from aggTrade, top 1% of
  recent prints and ≥ $10K, bubbles sized by notional, since the page opened. Candles carry taker
  buy volume end to end (REST, archive, SQLite, `/candles`); old stores re-download candles once.
  Verified in headless Chromium with archive candles and a mocked Binance socket (live trades not
  reachable from the sandbox). Display only: no statistic uses them yet.
- 2026-11-17: Competitor research (DeepCharts, Bookmap, LuxAlgo, CoinGlass, Hyblock and others):
  `docs/product/COMPETITORS.md` with paid-plan contents, evidence on what works, how each
  feature is built from free crypto data, and a rebuild order (ROADMAP parking lot). Docs only.
- 2026-11-11: Product named **GreenMTM** (owner); logo `public/greenmtm.svg` (favicon and top
  bar), no tagline. The Python package stays `tcs` internally.
- 2026-11-11: Chart follows the market: forming candle from Binance's kline stream, or OKX's when
  Binance is silent for 15 s, with a Live / Live · OKX / No live ticks badge; closed history
  refetched after each candle close; the view scrolls to a pattern only when it is clicked
  (it used to jump back on every refresh). Removed the vertical "close ✓" line. OKX daily/weekly
  candles now use UTC bars (`1Dutc`), not Hong Kong time.
- 2026-11-11: Chart shows key levels only, configurable in Display settings (owner feedback:
  too many zones, order blocks and labels). Display only; locations and statistics unchanged.
- 2026-11-11: PR #6 (ta_patterns Pattern library, 2026-11-04) merged into this branch and
  replaced by the single rule set at the owner's request (DECISIONS 2026-11-11).
- 2026-11-11: **Python analysis service** (`backend/`) is the one rule set: 11 chart patterns
  (bearish twins by mirroring), 10 TA-Lib candlestick patterns with our context, demand/supply
  zones, BOS/CHoCH, order blocks, fair value gaps; background statistics over 1–2 years per
  (pattern TF, level TF, location); FastAPI `/api/v1`. Chart, Pattern stats, Dashboard, Alerts and
  Risk read it; the TypeScript detectors and the `candlestick` package are gone. Order-book
  liquidity heatmap (Binance + OKX full depth). Found and fixed a look-ahead in zone
  de-duplication (an older zone's _final_ state decided whether a new zone counted) by the new
  invariant tests.

- 2026-11-03: Bull flag and inverse head and shoulders detectors (in-house, ATR-scaled,
  measured-move targets, no-look-ahead tests); available in detection settings, stats and alerts.

- 2026-11-03: TradingView-style Chart: all Binance timeframes with favourites, chart types,
  indicators (`indicatorts`) with panes/legend/settings, drawing tools
  (`lightweight-charts-drawing`), log/% scale, snapshot, fullscreen, live forming candle.
  Candlestick detection moved to the `candlestick` package (6 bullish patterns). Weekly candle
  closes fixed (Monday, not Thursday).

- 2026-11-03: Chart detection settings: pattern timeframes and zone source chosen separately from
  the view timeframe; higher-timeframe zones located by time with no look-ahead; multi-timeframe
  overlay; background stats per (pattern TF, zone TF). Fixed a vacuous `buildScan` test (its
  fixture produced no patterns).

- 2026-11-02: Dashboard v2 market overview built from the canvas design (all sources mocked in the
  browser test; live sources not reachable from the sandbox). Product name moved to `src/brand.ts`.
  Fixed `useSyncExternalStore` re-subscribing every render (would restart polling).

- 2026-11-02: Pattern stats, Risk calculator and Alerts built from the reference designs; Chart
  setup card links to both; Delta tagged USD and excluded from spreads; `HistoryService` refetches
  after a candle closes; sr-only labels no longer widen pages at phone width.

- 2026-11-02: Designs for Pattern stats, Risk calculator and Alerts drawn on a design canvas;
  reference images saved in `docs/product/ux/reference/`.

- 2026-11-02: Data bugs fixed: symbol search keeps JUP/SUPER (leveraged-token rule replaces the
  substring filter), removing a symbol unsubscribes its streams on all three exchanges and clears
  its book/trade data, exchange badge shows "down" after 3 failed reconnects; popular list uses
  POL and S instead of MATIC and FTM. Live streams not exercised (exchange hosts blocked in the
  test sandbox); covered by adapter unit tests.

- 2026-11-01: All checks green incl. the backend: 35 backend type errors fixed, replay crash
  (`engineState` undefined) and cooldown fixed, database folder bug fixed, `npm run backend` starts;
  unused `@electric-sql/pglite` removed; package renamed `crypto-dashboard`.

- 2026-11-01: Phase 1a build: crash and type errors fixed, alert cooldown bug fixed, dead files
  removed, analysis engine + Dashboard + Chart workspace added (PR #2).
- 2026-11-01: Context system, product and UX docs (PR #1, #2). `agent-docs/` folded in.
- 2026-10-24/25 (master `ad2c175`, `60bc1be`): charts placeholder, order book, alerts, Telegram +
  storage backend prototype, 191 tests ("code not reviewed").
