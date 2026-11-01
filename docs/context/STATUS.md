# Project status

_Last verified: 2026-11-01 · branch `claude/amazing-gauss-eyr3t5`_

## Phase

**Phase 1a: Dashboard + Chart workspace built (browser-side analysis).** The owner's priority
features run on real Binance history in the browser. The Python backend and QuestDB (Phase 1b)
are next; detection and statistics move server-side there. No confirmations yet (by design).

## Next up (todo pointer, details in `ROADMAP.md`)

1. Pattern stats, Risk calculator and Alerts screens from `docs/product/ux/PHASE1_UX.md`.
2. More detectors: bull flag, inverse head & shoulders, morning star; HVN/VAL as locations.
3. GitHub Actions CI: `vp check` + `vp test` + `npm run build`.
4. Phase 1b backend: Python collector + QuestDB, so history is stored and pooled across 20+ coins.
5. Data bugs: symbol filter (issue 3), unsubscribe on removal (4), exchange "down" state (5),
   Delta USD labelling + funding units (1, 2).

## Health

| Check | State |
| --- | --- |
| App in browser | ✅ loads; Dashboard and Chart verified end-to-end (desktop 1440 px, phone 400 px, no page errors, no horizontal scroll) with mocked Binance history |
| `npm run build` | ✅ (chart code split into its own chunk) |
| `npx vp lint .` | ✅ no errors or warnings (`src/backend` excluded, see DECISIONS) |
| `npx vp test` | ✅ 215 tests, 11 files |
| `npm run backend` | ❌ prototype doesn't start (`ERR_MODULE_NOT_FOUND`); frozen, replaced in Phase 1b |

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
- **Backend prototype** (`src/backend/`): frozen; not type-checked or linted with the app.

## Known issues

1. **Delta is USD-quoted, shown as USDT** (`DeltaExchangeAdapter`); spread panel mixes them.
2. **Delta funding-rate units unverified.**
3. **Symbol filter drops real coins** (`SymbolService` substring filter hides JUP, SUPER).
4. **Price subscriptions only grow**: removing a symbol never unsubscribes price/funding streams.
5. **Exchange badge never shows "down"** (sockets retry forever).
6. **Statistics are gross and browser-side**: before fees; limited to ~500 days × 10–12 coins on
   4h, so several setups show "too few cases". Phase 1b stores more history; Phase 2 adds costs.
7. **Pooled stats take a few seconds** on first load (≈24 REST requests); no progress bar yet.
8. Order book and trade prints: Binance only. Delta: no candles, no 24 h stats.
9. `getPopularSymbols()` lists rebranded coins (`MATIC`, `FTM`); `package.json` name is
   `vite-project`; `.idx/dev.nix` lists Svelte/Vue extensions.

## History

- 2026-11-01: Phase 1a build: crash and type errors fixed, alert cooldown bug fixed, dead files
  removed, analysis engine + Dashboard + Chart workspace added (PR #2).
- 2026-11-01: Context system, product and UX docs (PR #1, #2). `agent-docs/` folded in.
- 2026-10-24/25 (master `ad2c175`, `60bc1be`): charts placeholder, order book, alerts, Telegram +
  storage backend prototype, 191 tests ("code not reviewed").
