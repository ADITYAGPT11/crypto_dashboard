# Project status

_Last verified: 2026-11-11 · branch `claude/keen-carson-blripw`_

## Phase

**Phase 1a: Dashboard, Chart, Pattern stats, Risk and Alerts built (browser-side analysis).** The owner's priority
features run on real Binance history in the browser. **Phase 1b has started:** the Python backend
(`backend/`) runs the ta_patterns pattern library and its statistics, shown on the Chart. QuestDB
and the collector are next. No confirmations yet (by design).

## Next up (todo pointer, details in `ROADMAP.md`)

1. Owner: run `npm run dev` + `npm run backend:py` against real Binance and spot-check the
   Pattern library (does each pattern look like its name on the chart?). Never run live here.
2. Owner picks the product name (one constant in `src/brand.ts` + `index.html` title) and reviews
   Dashboard v2; check Fear & Greed and CoinGecko load on the owner's machine.
3. More detectors: bull flag, inverse head & shoulders, morning star; HVN/VAL as locations.
4. Keep CI green: `.github/workflows/ci.yml` runs on every PR.
5. Phase 1b backend: Python collector + QuestDB, so history is stored and pooled across 20+ coins,
   and setup alerts run server-side.
6. Verify Delta funding-rate units (docs site unreachable from the dev sandbox).

## Health

First three rows re-verified 2026-11-11 from a clean `npm ci`; the rest 2026-11-04 (with `uv sync --locked`):

| Check                                                      | State                                                                                                                                                                                                                |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check` (`vp check`: format + lint + types)        | ✅ 221 files formatted; 0 errors or warnings in 163 files (backend included)                                                                                                                                         |
| `npm test`                                                 | ✅ 351 tests, 30 files                                                                                                                                                                                               |
| `npm run build` (`tsc -b` app + node + backend, then Vite) | ✅ chart code in its own chunk                                                                                                                                                                                       |
| `npm run dev`                                              | ✅ <http://localhost:3000>; Dashboard, Chart, Pattern stats, Risk, Alerts load with no page errors or sideways scroll (browser test at 1440 px and 400 px, mocked Binance history); `/api` proxy reaches the backend |
| Backend `uv run pytest` / `ruff` / `pyright`               | ✅ 20 tests (incl. no-look-ahead over the whole pipeline); ruff + pyright clean                                                                                                                                      |
| `npm run backend:py` + Chart                               | ✅ Pattern library list, card, markers and plan lines in a headless browser at 1440 px and 400 px, no page errors (synthetic history: Binance blocked in the sandbox)                                                |
| `npm run backend`                                          | ✅ bundles `src/backend` and starts on :3001; `/health` OK, SQLite file created under `./data/`                                                                                                                      |

## What exists

- **Dashboard** (`/`), top: market overview for the 10 research coins (`components/MarketOverview/`):
  ticker strip; ⌘K coin search with per-exchange price and listing; exchange connection chips;
  floating bubbles (size = 24h volume, colour = 24h / 7d change); sentiment (Fear & Greed gauge,
  avg funding, long/short ratio, OI 24h, breadth, BTC dominance; no combined score); market
  monitor table (price, 24h/7d, volume, 7d volatility, ATR, trend 4h/1d, funding, OI, corr. BTC,
  sortable); 30-day correlation matrix; liquidations (Binance stream since page open); BTC
  volatility regime + trading sessions; gainers/losers; data health. Each source fails on its
  own and shows "unavailable".
- **Dashboard** (`/`), below: scanner over watchlist + 10 liquid coins on 4h. Shows setups confirmed on
  the last 3 closed candles with pooled win rate, n, Wilson 95% range, break-even marker and
  verdict; a table of how every setup has performed; the pattern-to-confirmation pipeline;
  watchlist cards with a live price and 7-day sparkline.
- **Chart** (`/chart/:symbol`), TradingView-style, on Lightweight Charts + free packages:
  - Top bar: symbol, favourite timeframes + menu of every Binance interval 1m–1W (star to
    favourite), chart type (candles, hollow, Heikin Ashi, bars, line, area), **Indicators**
    dialog, Overlays (patterns, zones, volume profile), % and log scale, snapshot, fullscreen.
  - Indicators from `indicatorts` 2.6.1: MA, EMA, Bollinger, rolling VWAP, Parabolic SAR, Volume,
    RSI, MACD, Stochastic, ATR, OBV; panes for oscillators; legend per pane with values under the
    crosshair and hover controls (hide, settings with Inputs/Style tabs, remove). Saved per browser.
  - Drawing tools from `lightweight-charts-drawing` on a left rail (trend line, ray, horizontal
    and vertical line, channel, rectangle, Fibonacci, price range, long position, text, brush,
    magnet, hide all, remove all); drawings saved per symbol. Hidden on phones.
  - Live forming candle from the Binance kline stream (drawn only; analysis uses closed candles).
  - Detection settings: pattern timeframes (1h/4h/1d) and zone source chosen separately from the
    view; higher-TF patterns drawn as blocks with the signal at their close; setup card for the
    selected setup; `SetupStatsService` measures every timeframe in the background.
- **Pattern library** (Chart sidebar + card under the chart), from the Python backend: ta_patterns
  detectors on the view timeframe (chart formations by default; short-term and candlesticks on a
  toggle), newest first with "Now" for the last 3 candles. Picking one draws its past cases on this
  coin as ▲/▼ W/L markers with entry/stop/target lines, and shows pooled (10 coins) and this-coin
  win rate, Wilson range, break-even, corrected verdict, expectancy and the move 5/10/20 candles
  later; past cases are clickable for a visual check. Same 1-ATR stop / 2-ATR target for every
  pattern. Backend not running → the panel says how to start it; the rest of the Chart is unchanged.
- **Pattern stats** (`/stats`): setup library on 1h / 4h / 1d (KPIs, n, win rate, Wilson range vs
  break-even, avg win/loss, expectancy, verdict), verdict filter and sort, a per-coin breakdown
  per row, the path to a confirmation and the overfitting guards.
- **Risk** (`/risk`): position size, notional, leverage, reward:risk, fees, break-even and expected
  value at the setup's pooled win rate and range. Pre-filled from the Chart's "Size this trade";
  account size, risk % and fee remembered in this browser. Long and short.
- **Alerts** (`/alerts`): "tell me when [coin] prints a [setup] on [TF]" with the record shown
  before saving; rules and firings in this browser; checked every minute while a TCS tab is open
  (history refetched when a candle closes); each firing tracked to its outcome; in-app banner;
  Telegram via the backend prototype through the dev `/api` proxy when it runs and is configured.
- **Analysis engine** (`src/utils/`, pure + tested): volume profile, zones, chart patterns
  in-house (double bottom, inverse head and shoulders with a sloped neckline, bull flag), candlestick patterns via the `candlestick` package (hammer, inverted hammer,
  bullish engulfing, bullish harami, tweezer bottom, three white soldiers) with our context
  filters, outcome resolution, setup statistics, multi-coin scan.
- **History** (`src/services/HistoryService.ts`): ~3,000 closed candles per coin from Binance
  USDⓈ-M public REST, cached until a newer candle closes.
- **Markets** (`/markets`): the earlier dashboard (price table, order book, spread panel, alert
  rule builder). Its chart panel now links to the Chart page.
- **Backend prototype** (`src/backend/`): Express + `node:sqlite` + Telegram client; type-checked
  and linted with the app, starts with `npm run backend`. Replaced by the Python backend in Phase 1b.

## Known issues

- **Pattern library not run against real Binance** (blocked in the dev sandbox): tested with
  synthetic gapless candles end to end. Which ta_patterns detectors fire, and how often, on real
  crypto is unverified. First stats load scans 11 coins (~10 s), cached until the next close.
  Needs `npm run backend:py` next to `npm run dev` (the `/tcs` proxy is dev-only).
- **Library stats use one bracket for all patterns** (1 ATR stop, 2 ATR target), not each
  pattern's textbook target; adjustable via the API (`stop_atr`, `target_atr`, `max_bars`), not
  in the UI yet. Gross, before fees.
- **Live candle and drawings not exercised against real Binance** (exchange hosts blocked in the
  dev sandbox; tested with mocked history and the drawing flow in a headless browser).
  Indicators use closed candles only (the forming candle is drawn, not computed).

- **Detection settings apply to the Chart only.** Dashboard, Pattern stats and Alerts still use
  same-timeframe zones on their own timeframe. 1h history is ~125 days, so 1h setups often show
  "too few cases".

1. **Delta funding-rate units unverified** (shown with an "units unverified" tag). Delta prices are
   USD-quoted: they share the asset's row with a "USD" tag and are left out of the spread panel.
2. **Setup alerts are browser-side**: they run only while a TCS tab is open; rules live in this
   browser's storage. Telegram works only with `npm run dev` + `npm run backend` (the `/api` proxy
   is dev-only) and a bot configured via `POST /telegram/config`. Not tested against real Telegram.
3. **Statistics are gross and browser-side**: before fees; limited to ~500 days × 10–12 coins on
   4h, so several setups show "too few cases". Phase 1b stores more history; Phase 2 adds costs.
4. **Pooled stats take a few seconds** on first load (≈24 REST requests); no progress bar yet.
5. Order book and trade prints: Binance only. Delta: no candles, no 24 h stats.
6. `.idx/dev.nix` lists Svelte/Vue extensions.
7. **Dashboard v2 live sources unverified**: Binance REST shapes are tested with fixtures; Fear &
   Greed (alternative.me) and BTC dominance (CoinGecko) are unchecked against the live APIs and
   CORS. Liquidation totals start from page open and undercount (Binance sends ≤1/coin/s).
8. The Markets page's older price-rule alerts are separate from setup alerts and still browser-only.

## History

- 2026-11-11: `indicatorts` 2.2.2 (deprecated on npm) → 2.6.1, pinned; no `npm ci` warning. Golden
  test against 2.2.2's outputs: 8 indicators identical; ATR now Wilder (SMA-seeded, equals the
  backend ATR; 2.2.2 was up to 11% off) and Parabolic SAR no longer lands inside a candle
  (upstream fixes). trading-signals compared and not adopted (TOOLING → Reuse audit).

- 2026-11-04: Python backend scaffolded (`backend/`: uv, FastAPI, CI job). Pattern library from
  ta_patterns (MIT, audited: no look-ahead on any of 300 detectors): events on the completing
  candle, ATR-bracket outcomes, Wilson stats pooled over 10 coins with a multiple-testing
  correction (random-walk test: 2 false edges without it, 0 with). Chart shows the patterns, their
  past cases and stats.

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
