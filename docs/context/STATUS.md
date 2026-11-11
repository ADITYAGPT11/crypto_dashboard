# Project status

_Last verified: 2026-11-11 · branch `claude/eloquent-maxwell-vyoqfw`_

## Phase

**Phase 1b started: the Python analysis service owns every rule.** Pattern detection, zones,
order blocks, outcomes and statistics run in `backend/` (Python 3.12, FastAPI, TA-Lib, SQLite).
The chart asks it for the recent candles' analysis (refetched after every candle close); a
background job measures every setup over one to two years of the research coins with the same
code. The browser draws, streams live candles and order books, and sizes trades. No
confirmations yet (by design).

## Next up (todo pointer, details in `ROADMAP.md`)

1. Owner: run `npm start` on a machine that reaches Binance, let the first
   statistics run finish (about 15 min for 10 coins × 3 timeframes × 2 years), and review the
   rule set in `docs/product/patterns.md`.
2. Server-side setup alerts + Telegram in Python (replace the Node prototype's role).
3. QuestDB collector (live klines, funding, OI) replacing the SQLite store; Docker Compose.
4. Random-entry baseline per setup (does a pattern beat chance with the same stop/target?).
5. Verify Delta funding-rate units (docs site unreachable from the dev sandbox).

## Health

Verified 2026-11-11:

| Check                                                            | State                                                                                                                                                                                                       |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check` (`vp check`: format + lint + types)              | ✅                                                                                                                                                                                                          |
| `npm test`                                                       | ✅ 303 tests, 29 files                                                                                                                                                                                      |
| `npm run build` (`tsc -b` app + node + backend, then Vite)       | ✅ chart code in its own chunk                                                                                                                                                                              |
| `npm run api:check` (ruff format + lint, pyright strict, pytest) | ✅ 89 tests (invariants on every detector, per-clause rules, golden snapshot, API, generated TS types)                                                                                                      |
| `npm run api`                                                    | ✅ :8000; stats job on 3 coins × 1 year × 1h/4h/1d from the archive in ~17 s                                                                                                                                |
| `npm start`                                                      | ✅ starts web, api and the Node prototype with prefixed logs; Ctrl+C stops all three; finds uv off PATH (`~/.local/bin`, `~/.cargo/bin`) and prints the install command when it is missing                  |
| `npm run dev` + `npm run api`                                    | ✅ Chart, Pattern stats, Dashboard, Alerts, Risk in headless Chromium at 1440 px and 400 px: no app errors, no sideways scroll (Binance blocked in the sandbox: candles via the service's archive fallback) |
| Liquidity heatmap                                                | ✅ with a real OKX book replayed through a mocked socket; ❌ not exercised live (Binance geo-blocked, OKX WebSocket port 8443 blocked in the sandbox)                                                       |

## What exists

- **Analysis service** (`backend/src/tcs/`, `npm run api`): `analysis/` the rule set
  (`engine.analyze` is the single entry point; catalogue and `RULESET_VERSION` in `catalog.py`;
  rules written out in `docs/product/patterns.md`); `jobs/stats_job.py` background statistics;
  `marketdata/` Binance REST + `data.binance.vision` archive backfill; `store/sqlite.py`;
  `api/` FastAPI `/api/v1/{health,patterns,candles,analysis,stats,stats/setup,stats/run,scanner}`.
  `src/api/schema.ts` is generated from it (`npm run api:types`; a test fails when stale).
- **Chart** (`/chart/:symbol`): TradingView-style (timeframes, chart types, indicators, drawings,
  live forming candle) plus the service's patterns (direction arrows, outlines, necklines,
  trendlines), demand/supply zones, order blocks, fair value gaps, volume profile and a
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

1. **Live data not exercised against real exchanges from the sandbox**: Binance REST/WS are
   geo-blocked there and OKX's WebSocket port is closed. Live candles (Binance and the OKX
   fallback) were tested with simulated kline streams, the REST tail with the archive, and live
   order books with a replayed real OKX book. Where Binance REST is blocked the service's data
   ends at the last archived day and the chart says how many candles behind.
2. **Statistics need a first run**: until the background job finishes (minutes), Pattern stats,
   the setup card and the scanner show "not measured yet".
3. **Setup alerts run in the browser** (every minute while a tab is open) and use same-timeframe
   levels; Telegram still goes through the Node prototype (`npm run backend`).
4. **Statistics are gross** (no fees/slippage) and in-sample; Phase 2 adds costs and
   out-of-sample tests. Many setups have too few cases per bucket on 1d.
5. **Order-book depth is shallow**: OKX sends 400 levels, Binance 1000, so pools are near the
   price (for BTC tens to hundreds of dollars away). The heatmap starts when the page opens.
6. Delta funding-rate units unverified; Delta prices are USD-quoted (tagged, left out of spreads).
7. Dashboard v2 sources Fear & Greed and CoinGecko unverified against the live APIs.
8. `.idx/dev.nix` lists Svelte/Vue extensions; the Markets page's price-rule alerts are separate.

## History

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
