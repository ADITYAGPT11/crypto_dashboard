# Project status

_Last verified: 2026-11-02 · branch `claude/ecstatic-gauss-sqnz3z`_

## Phase

**Phase 1a: Dashboard + Chart workspace built (browser-side analysis).** The owner's priority
features run on real Binance history in the browser. The Python backend and QuestDB (Phase 1b)
are next; detection and statistics move server-side there. No confirmations yet (by design).

## Next up (todo pointer, details in `ROADMAP.md`)

1. Pattern stats, Risk calculator and Alerts screens from `docs/product/ux/PHASE1_UX.md`.
2. More detectors: bull flag, inverse head & shoulders, morning star; HVN/VAL as locations.
3. Keep CI green: `.github/workflows/ci.yml` runs on every PR.
4. Phase 1b backend: Python collector + QuestDB, so history is stored and pooled across 20+ coins.
5. Data bugs: Delta USD labelling + funding units (issues 1, 2).

## Health

Verified 2026-11-02 from a clean `npm ci`:

| Check                                                      | State                                                                                                                                              |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check` (`vp check`: format + lint + types)        | ✅ 139 files formatted; 0 errors or warnings in 95 files (backend included)                                                                        |
| `npm test`                                                 | ✅ 226 tests, 14 files                                                                                                                             |
| `npm run build` (`tsc -b` app + node + backend, then Vite) | ✅ chart code in its own chunk                                                                                                                     |
| `npm run dev`                                              | ✅ <http://localhost:3000>; Dashboard, Chart, Markets, About load with no page errors (browser test at 1440 px and 400 px, mocked Binance history) |
| `npm run backend`                                          | ✅ bundles `src/backend` and starts on :3001; `/health` OK, SQLite file created under `./data/`                                                    |

## What exists

- **Dashboard** (`/`): scanner over watchlist + 10 liquid coins on 4h. Shows setups confirmed on
  the last 3 closed candles with pooled win rate, n, Wilson 95% range, break-even marker and
  verdict; a table of how every setup has performed; the pattern-to-confirmation pipeline;
  watchlist cards with a live price and 7-day sparkline.
- **Chart** (`/chart/:symbol`): Lightweight Charts with candles, volume, EMA 50, Bollinger;
  overlay of demand/supply zones, visible-range volume profile and the selected pattern; entry,
  stop and target price lines; W/L markers for past cases of the selected setup on this chart.
  Side panel: recent patterns and a setup card (pooled and this-coin stats, avg move,
  expectancy, confluence checks, last 5 cases). Below: key volume levels and zones.
- **Analysis engine** (`src/utils/`, pure + tested): volume profile, zones, patterns (double
  bottom, bullish engulfing, hammer), outcome resolution, setup statistics, multi-coin scan.
- **History** (`src/services/HistoryService.ts`): ~3,000 closed candles per coin from Binance
  USDⓈ-M public REST, cached per session.
- **Markets** (`/markets`): the earlier dashboard (price table, order book, spread panel, alert
  rule builder). Its chart panel now links to the Chart page.
- **Backend prototype** (`src/backend/`): Express + `node:sqlite` + Telegram client; type-checked
  and linted with the app, starts with `npm run backend`. Replaced by the Python backend in Phase 1b.

## Known issues

1. **Delta is USD-quoted, shown as USDT** (`DeltaExchangeAdapter`); spread panel mixes them.
2. **Delta funding-rate units unverified.**
3. **Statistics are gross and browser-side**: before fees; limited to ~500 days × 10–12 coins on
   4h, so several setups show "too few cases". Phase 1b stores more history; Phase 2 adds costs.
4. **Pooled stats take a few seconds** on first load (≈24 REST requests); no progress bar yet.
5. Order book and trade prints: Binance only. Delta: no candles, no 24 h stats.
6. `.idx/dev.nix` lists Svelte/Vue extensions.
7. The backend is not called by the UI yet (alerts still evaluate in the browser).

## History

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
