# Project status

_Last verified: 2026-11-26 · branch `claude/beautiful-goodall-ac540j` · rule set r13_

## Phase

**Phase 1b: the Python analysis service owns every rule.** Pattern detection, zones, order
blocks and the six-item **setup checklist** run in `backend/` (Python 3.12, FastAPI, TA-Lib,
SQLite). The chart and the scanner ask it for the recent candles' analysis (refetched after every
candle close). **No trade plan and no win-rate statistics** since 2026-11-22 (owner; see
History): a pattern is shown with "4/6 checks", never a probability. The browser draws, streams
live candles and order books, and sizes trades. No confirmations (by design).

## Next up (todo pointer, details in `ROADMAP.md`)

0. Owner: run `npm start` where Binance and OKX are reachable and check the depth recorder goes
   live (`/api/v1/depth/BTC-USDT` feeds) and the heatmap keeps its history after a reload. Then
   order-flow step 4: liquidation feed, OI/funding panels and the estimated liquidation map
   (`COMPETITORS.md` §4).
1. Owner: review the setup checklist (rule set r13) on live charts; thresholds are in
   `docs/product/patterns.md` → Setup checklist.
2. Server-side setup alerts + Telegram in Python (replace the Node prototype's role).
3. QuestDB collector (live klines, funding, OI) replacing the SQLite store; Docker Compose.
4. Verify Delta funding-rate units (docs site unreachable from the dev sandbox).

## Health

Verified 2026-11-11 (checks and test counts 2026-11-22):

| Check                                                            | State                                                                                                                                                                                        |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check` (`vp check`: format + lint + types)              | ✅                                                                                                                                                                                           |
| `npm test`                                                       | ✅ 376 tests, 39 files                                                                                                                                                                       |
| `npm run build` (`tsc -b` app + node + backend, then Vite)       | ✅ chart code in its own chunk                                                                                                                                                               |
| `npm run api:check` (ruff format + lint, pyright strict, pytest) | ✅ 158 tests (invariants on every detector, per-clause rules, checklist, golden snapshot, API, generated TS types)                                                                           |
| `npm run api`                                                    | ✅ :8000                                                                                                                                                                                     |
| `npm start`                                                      | ✅ starts web, api and the Node prototype with prefixed logs; Ctrl+C stops all three; finds uv off PATH (`~/.local/bin`, `~/.cargo/bin`) and prints the install command when it is missing   |
| `npm run dev` + `npm run api`                                    | ✅ Chart, Dashboard, Alerts, Risk in headless Chromium at 1440 px and 400 px: no app errors, no sideways scroll (Binance blocked in the sandbox: candles via the service's archive fallback) |
| Liquidity heatmap                                                | ✅ with a real OKX book replayed through a mocked socket; ❌ not exercised live (Binance geo-blocked, OKX WebSocket port 8443 blocked in the sandbox)                                        |

## What exists

- **Analysis service** (`backend/src/tcs/`, `npm run api`): `analysis/` the rule set
  (`engine.analyze` is the single entry point; catalogue and `RULESET_VERSION` in `catalog.py`;
  rules written out in `docs/product/patterns.md`; `checklist.py` the setup checklist);
  `marketdata/` Binance REST + `data.binance.vision` archive; `store/sqlite.py` (candles, depth);
  `api/` FastAPI `/api/v1/{health,patterns,candles,analysis,scanner,depth}`; `depth/` order-book recorder.
  `src/api/schema.ts` is generated from it (`npm run api:types`; a test fails when stale).
- **Chart** (`/chart/:symbol`): TradingView-style (timeframes, chart types, indicators, drawings,
  live forming candle) plus the service's patterns, the selected one drawn after the industry
  convention (shaded W / M, H&S, triangle, wedge or flag box, key-point tags, breakout ring,
  checklist score "4/6 checks" on the name tag or faint inside a candlestick pattern's box, which
  covers its own candles, not the confirmation candle; no entry / stop / target, position box or
  trailing stop; other overlays fade), demand/supply zones, order blocks, fair value gaps, volume profile and a
  **liquidity heatmap** layer with a pools table. Only **key levels** are drawn (Overlays →
  Display settings, saved per browser): intact, nearest 2 of each kind, zones ≥ 2 ATR departure,
  overlaps merged; fresh-only, broken levels, labels and the number of pattern tags are options.
  Full-width chart; the Dashboard's **watchlist** as chips above it (24 h change, add / remove the
  current coin). **Patterns** button in the chart toolbar: a popover with two multi-select
  dropdowns, the timeframes (15m / 1h / 4h / 1d) and the patterns per direction (chart and candlestick
  sections, bullish / bearish, trend icons); chart patterns on and candlesticks off by default;
  saved per browser and applied on every page. Zones and order blocks come from the pattern's own
  timeframe. **Last 10 patterns** under it: the 10 newest detections on the picked timeframes
  meeting at least 3 of 6 checks (`utils/patternList.ts`), in two columns of compact rows, each
  with its six checks as inline tags (OB · RSI · VOL · VWAP · ATR · ST; hover for what was
  observed), a "VOL↓" information tag when volume fell while a flag, triangle or wedge formed
  (not a check), and its score; patterns confirmed on the same candle, timeframe and side share
  one row ("Double bottom + Rising wedge"). On the chart (labels name only, no score) only the selected one is
  drawn, by default the newest; the other listed ones in view can be drawn faintly (Display
  settings → "Other listed patterns in view", off by default). Clicking a row draws it and, when the pattern's timeframe is lower than the chart's,
  switches the chart down to it once; a footer line names it with Alert me.
- **Pattern choice is display only.** The backend detects every pattern whatever is picked.
- **Dashboard** (`/`): market overview (unchanged), scanner from the service (last 3 closed
  candles, picked patterns, most checks met first, which checks passed), watchlist.
- **Risk** (`/risk`): position sizing from your own entry, stop and target. **Alerts**
  (`/alerts`): rules fire on a pattern at any location; each firing carries the close and the
  checklist; old stored rule keys (with a location) and firings still load.
- **History** (`HistoryService`): Binance REST from the browser, falling back to the service's
  stored candles.
- **Tech overview** (`/tech-overview`): clickable architecture map of the whole system; every
  module and flow opens a detailed map (`/tech-overview/<map>`: connectivity, market data,
  heatmap, analysis engine, alerts, screens, confirmation roadmap) with files, links
  and built vs planned counts. Data in `TechOverviewPage/maps.ts`; tests check every listed file.
- **Markets** (`/markets`) and the **Node prototype** (`src/backend/`, Telegram) are unchanged.

## Known issues

1. **Binance REST (and spot WebSocket) refuse the dev sandbox's region** (HTTP 451, Binance's
   own geo rule; no network setting fixes it). Everything else is verified live there since
   2026-11-17: Binance futures WebSockets, OKX, Delta, CoinGecko, alternative.me. So in the
   sandbox candle history comes from the archive (up to a day behind), Binance's book cannot sync
   (no snapshot) and funding / OI / 24h volume show "–". Where Binance REST is reachable none of
   this applies.
2. **The checklist is not measured**: it describes the context a pattern formed in; nothing in
   the app says how often such setups worked (owner's choice, 2026-11-22).
3. **Setup alerts run in the browser** (every minute while a tab is open) and use same-timeframe
   levels; Telegram still goes through the Node prototype (`npm run backend`).
4. **Order-book depth**: Binance (1 000 levels, socket) + OKX (400 live, 5 000 from REST every
   5 s) + Delta (whole book every ~3 s) are added up within ±2% of the mid. Delta is USD-quoted
   and added at face value (USD ≈ USDT, inside one bucket). Heatmap history comes from the analysis
   service's recorder (BTC, ETH, and coins opened with the heatmap on, 7 days); without the
   service it starts when the page opens. The recorder ran live on OKX in the sandbox (800 levels,
   one column a minute); Binance's half needs REST for its snapshot (see issue 1).
5. Delta funding-rate units unverified; Delta prices are USD-quoted (tagged, left out of spreads).
6. `.idx/dev.nix` lists Svelte/Vue extensions; the Markets page's price-rule alerts are separate.

## History

- 2026-11-26: **Rule set r13: six patterns added** (owner). Rectangle and rising / falling
  channels (parallel lines in `trendlines.py`), triple bottom / top, bull / bear pennant, cup with
  handle / inverted (`chart_patterns.py`), bullish / bearish liquidity sweep (new `sweeps.py`).
  Drawn on the chart (`patternGeometry.ts`). ETH 4h golden year: 225 → 289 (`DECISIONS.md`).
- 2026-11-26: **Rule set r12: the rest of the textbook review** (owner). Triangle and wedge
  breakouts at most 75% of the way to the apex; breakouts against the usual direction are
  signals that way (catalogue bias "either"); H&S sides at most 2× apart in width; hammer and
  inverted hammer need a prior fall again (so hanging man and shooting star need a rise);
  "VOL↓" tag; one list row per breakout. ETH 4h golden year: 253 → 225 (`DECISIONS.md`).
- 2026-11-26: **Rule set r11: double-bottom peak, five-touch triangles and wedges** (owner, after a
  rule-by-rule review against the textbooks). The double bottom / top's peak is now strictly
  between the two lows' candles (never a low's own wick); triangles and wedges need 3 + 2 swings
  (the 2 + 2 fallback is gone). ETH 4h golden year: 273 → 253 detections (`DECISIONS.md`).
- 2026-11-26: **Chart draws only the latest pattern** (owner). The faint drawing of the other
  listed patterns is off by default (`showOtherPatterns`, renamed from `otherPatterns` so the
  saved "on" from 2026-11-22 is dropped); the toggle stays in Display settings.
- 2026-11-22: **Chart labels never overlap** (owner). `utils/labelPlacement.ts`: zone and
  volume-profile labels reserve their space first, then the selected pattern's labels, then
  each faint pattern name tries small up/down nudges and is left out when no spot is free. A
  zone label that would sit on another label is left out (its zone is still drawn).
- 2026-11-22: **Chart: names only, every listed pattern in view, switch down on click**
  (owner). Chart labels drop the "N/6 checks" score; the other listed patterns whose candles
  are on screen are drawn faintly (shape + name) instead of small timeframe tags (the "Pattern
  tags" count setting became the `otherPatterns` on/off). Clicking a 15m pattern on a 4h chart
  switches the chart to 15m (`viewTfFor`); same or higher timeframes leave it.
- 2026-11-22: **Last 10 patterns with 3+ checks; 15m timeframe** (owner). The chart's pattern
  list shows the 10 newest detections with at least 3 of 6 checks, one row per detection (was
  one row per pattern and direction, every score); `utils/patternGroups.ts` replaced by
  `utils/patternList.ts`. 15m added to the pattern timeframes (`PATTERN_TFS`, `DETECTION_TFS`)
  and alert intervals; teal badge. List layout C (owner, of four mock-ups): two columns, checks
  inline, no expanding rows; a leftover rule that dimmed every row is gone. Rules unchanged
  (still r10).
- 2026-11-22: **Trade plan and statistics removed; setup checklist (rule set r10)** (owner).
  Gone: outcome resolution and the trade plan (`outcomes.py`, `plan.py`, `costs.py`), the
  statistics (`stats.py`, `jobs/stats_job.py`, `/stats*` routes, stats tables and funding
  history in SQLite, dropped on start), the confidence filter (`confidence.py`) and order-flow
  context (`flow.py`), the Pattern stats page, records on the Dashboard / Risk / Alerts, the
  chart's position box, trailing stop, exit markers and plan price lines. New: `checklist.py`,
  six yes/no checks at the confirmation candle (at a bullish order block / demand zone, RSI
  50–70, volume ≥ 1.5× average, close above VWAP(20), ATR above its 50-candle mean, Supertrend up;
  mirrored for shorts) shown as "4/6 checks" on the chart, in the pattern rows, the Dashboard
  scanner and alerts. `indicators.py` gains RSI, rolling VWAP and Supertrend. Entries below
  describe rule sets and features that no longer exist after this change.

- 2026-11-22: **Chart page layout C** (owner, designed on the canvas first, idea C of three).
  The right column is gone: the chart is full width, the watchlist sits above it as chips, the
  Patterns settings open from a toolbar button, and the pattern list + setup card became
  expandable rows under the chart with this coin's record per timeframe (the pooled all-coins
  record and last cases stay on Pattern stats). `GET /api/v1/stats?symbol=` returns one coin's
  record of every setup (`useCoinStats`); `utils/patternGroups.ts` groups detections. `SetupCard`
  removed.
- 2026-11-21: **Chart page: levels on the chart, not in cards** (owner, designed first). The Key
  volume levels and Zones and order blocks cards under the chart are gone; with Volume profile on,
  the chart draws light dashed POC, VAH and VAL lines (visible range) with small labels beside
  the histogram (was one bright POC line). HVN / LVN are no longer listed. Zones and order blocks
  stay on the chart via Overlays. The "Found by the analysis service" line under Patterns is gone.
- 2026-11-21: **Patterns panel as two dropdowns; lighter pattern drawing** (owner, designed on a
  canvas first). Timeframes and patterns are multi-select dropdowns; the pattern menu lists every
  supported pattern per direction under Chart / Candlestick and Bullish / Bearish, with custom
  checkboxes, select all / clear per section and a slim scrollbar that fades while more is below.
  Candlestick patterns are back as an option (off by default); the choice applies on Chart,
  Pattern stats, Dashboard and Alerts. Drawing: the name and key-point tags are 10 px see-through
  pills, the entry / stop / target zones 6% (were 14%), no text inside the box, and the price axis
  shows only the three prices (no Entry / Stop / Target words). The win-rates status line is gone.
- 2026-11-22: **Confidence filter (rule set r9)** (owner). Score 0-3 from order flow and CVD
  divergence (re-picked on year 1, confirmed on year 2 under the r8 plan); each setup passes only
  when its record at that score clears break-even after costs (`OccurrenceOut.passes`). Filtered
  setups are drawn grey ("filtered") on the chart, in the timeframe tags and in the pattern list.
  Trade plan unchanged. On the preview run only a few groups pass, all shorts (`DECISIONS.md`).
- 2026-11-22: **Trade plan B with strict 5-minute fills (rule set r8)** (owner). Every trade:
  entry at the confirmation close; pattern stop (on 1h 0.5 ATR beyond the invalidation price);
  TP1 = the target, then a stop trailing 2 ATR behind the best price, moved at candle closes;
  120-candle limit; win = closed in profit; setups costing over 0.1R skipped (`analysis/plan.py`).
  Trades are walked on 5-minute candles (new `5m` timeframe; stats job and chart load them) and a
  stop already passed fills at the candle's open. The check showed earlier trailing results were
  too optimistic; the plan is still negative after costs (`DECISIONS.md`). Chart: plan text
  "TP1 · trail starts", exit marker at the real fill, 120-candle window.
- 2026-11-22: **Confidence % on every pattern (rule set r7)** (owner). `analysis/confidence.py`
  counts four checks (trend, flow, calm volume, RSI not stretched; each kept for lifting the win
  rate in both years of 2 × 10 coins); the stats job adds `score:0..4` contexts and
  `/api/v1/analysis` gives each occurrence `score` + `confidence` (that score's measured win rate
  and Wilson range, or the pattern's record when under 30 cases). Drawn faintly in the
  candlestick box (above it when too narrow) and on chart-pattern tags.
  Verified in headless Chromium on real BTC 4h stats (bullish engulfing 28% ±6).
- 2026-11-22: **Candlesticks: no trend filter (rule set r6)** (owner). A/B on 2 years × 10 coins:
  the prior-decline filter did not raise win rates and kept a third of the cases; a "big body"
  engulfing rule did not help either (not adopted). Chart box covers only the pattern's own
  candles, not the confirmation candle. Statistics must be re-run. `DECISIONS.md`.
- 2026-11-21: **Simpler pattern UI** (owner). The app shows chart patterns only; one setting picks
  the timeframes they are looked for on (was a dropdown per pattern, a level-source selector and
  a statistics table); setups are no longer split by location (zone / order block / confluence)
  or order flow on any screen: the setup card, Pattern stats, Dashboard and Alerts read the
  any-location record. Setup card loses the any-location baseline, this-coin-only record,
  trailing-TP block, context checks and order-flow table. Recent cases now include trades closed
  at the holding limit (r5 counts them; the API returned only wins and losses). Backend rules,
  statistics and API unchanged otherwise.
- 2026-11-21: Chart no longer shades a higher-timeframe pattern's source candles in blue (owner:
  the tag, e.g. "Bear flag · 1d", already names the timeframe). Display only.
- 2026-11-21: **Rule review against the industry standard (rule set r5)**. Audited every rule
  against TA-Lib's C source, StockCharts ChartSchool (Nison) and the textbooks, and on a year of
  real BTC/ETH/SOL 1h/4h/1d candles. Fixed: (1) double bottoms/tops and H&S whose breakout was
  already past the target counted as wins at negative R (19 a year on 3 coins) → skipped;
  (2) expired trades were left out of the win rate and expectancy (up to 53% of a pattern's
  cases) → closed at the market and counted; (3) TA-Lib's shooting star, inverted hammer and
  morning/evening star need body gaps crypto never has (hits were one-tick flukes) and (4) its
  hammer family accepts a shadow 1× the body (Nison: 2×) → **candlestick rules in-house**, bearish
  twins by mirroring, TA-Lib kept for ATR/EMA/SMA; (5) a 1-tick "downtrend" counted → close below
  EMA(20) and ≥ 0.5 ATR down in 5 candles; (6) hanging man / inverted hammer stops of 0.15 ATR →
  every pattern waits for a confirmation close beyond its range (stars confirm themselves);
  (7) engulfing of a doji excluded; (8) reversal chart patterns need a prior trend (32–42% had
  none); (9) holding limit = 30 candles or the formation's length; (10) flags must drift sideways
  or down. Re-audit: 0 targets passed, 0 reversals without a trend, candlestick stops ≥ 1 ATR.
  Far fewer candlestick setups (1h bullish engulfing 1,062 → 240 a year on 3 coins). Every
  clause has a test that fails when the clause is removed (checked by mutation). Statistics must
  be re-run for r5.
- 2026-11-21: **Tech overview** (`/tech-overview`, nav link): the architecture as clickable maps,
  drill-down from each module or flow into its detailed map. Replaces the standalone
  `docs/architecture-flow.html`.
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
