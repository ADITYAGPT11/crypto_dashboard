# Project status

_Last verified: 2026-11-01 · after merging `master` (commits `ad2c175`, `60bc1be`) into
`claude/amazing-gauss-eyr3t5`._

## Phase

**Phase 0: stabilise the browser app.** It has grown a lot (charts, order book, alerts, a
backend prototype), but it is **currently broken** (see Health). No research, backtests or
signals exist yet.

## Next up (todo pointer, details in `ROADMAP.md` → Phase 0)

1. **Fix the runtime crash + 65 type errors** (Health below). The dashboard renders a blank page.
2. Delete dead files (list below) and the unused `@electric-sql/pglite` dependency.
3. Make `npm run build` (tsc + Vite) and `vp check` pass; add GitHub Actions CI.
4. Data bugs: symbol filter (issue 3), unsubscribe prices on removal (4), exchange "down" state (5),
   Delta USD labelling + funding units (1, 2).

## Health

| Check | State |
| --- | --- |
| App in browser | ❌ **blank page**: `ReferenceError: CANDLE_INTERVALS is not defined` (`src/components/MainContainer/MainContainer.tsx:152`; `setActiveInterval` also undefined) |
| `npm run build` (`tsc -b` + Vite) | ❌ 65 type errors from master's "AI code" commit (also fails on master itself) |
| `npx vp build` (bundle only, no type check) | ✅ |
| `npx vp test` | ✅ 191 tests pass in 9 files |
| `npm run lint` | ❌ type-aware lint reports the same type errors |
| `npm run backend` | ❌ crashes on start: `ERR_MODULE_NOT_FOUND` (extensionless imports under `node --experimental-strip-types`) |
| Index entry | ✅ fixed in this PR: `index.html` → `/src/main.tsx` (was `Main.tsx`, broke Linux builds) |

Type errors by file: `src/backend/index.ts` 29 · `src/components/OrderBookPanel.tsx` 13 (dead file) ·
`src/services/AlertService.ts` 9 (missing type imports) · `src/services/AlertEngine.ts` 5 ·
`src/backend/storage/replay.ts` 4 · `ChartPanel.tsx` 2 (`CandleService.fetchCandles` doesn't
exist) · `MainContainer.tsx` 2 · `src/backend/storage/database.ts` 1.

## What exists (code written; works once the crash is fixed, unverified end-to-end)

- **Live data**: Binance spot+futures, OKX spot+swap, Delta India perps; prices, funding,
  connection badges, auto-reconnect. Per-cell freshness (stale after 6 s) + 24 h change/volume
  (REST-polled; Binance + OKX).
- **Watchlist + layout**: symbols and panel order/visibility persisted in `localStorage`.
- **Charts** (`ChartPanel`, TradingView lightweight-charts 5.2): candles from WS + REST backfill
  with scroll-back; indicators EMA/SMA/RSI/MACD/VWAP/Bollinger/ATR (pure functions, tested).
- **Order book** (`dashboard/OrderBookPanel`, Binance spot only): top-20 depth ladder, spread,
  imbalance, large levels, liquidity churn, large trade prints.
- **Arbitrage panel**: cross-exchange last-price spread (`ArbitrageService`). Ignores fees and the
  USD/USDT mismatch, so treat it as an observation, not an opportunity.
- **Alerts**: typed rules (price cross, % move, volume spike, indicator threshold, book imbalance,
  large liquidity), deterministic engine evaluated every 2 s, rule builder UI, trigger log in
  `localStorage`.
- **Backend prototype** (`src/backend/`, TypeScript/Express): Telegram delivery service, SQLite
  storage (`node:sqlite`) and a replay engine. Not wired to the UI and doesn't start (above).
  Per DECISIONS it is a prototype; the real backend is Python (Phase 1).

## Known issues

1. **Delta is USD-quoted, shown as USDT**: `BTC-USDT` ↔ `BTCUSD` in `DeltaExchangeAdapter`.
   Spread/basis numbers (incl. the arbitrage panel) mix USD and USDT.
2. **Delta funding-rate units unverified**: Binance/OKX ×100 to percent; Delta's `fr` used as-is.
3. **Symbol filter drops real coins**: `SymbolService` substring filter (`UP`, `DOWN`, `BULL`, `BEAR`)
   hides e.g. `JUP-USDT`, `SUPER-USDT`.
4. **Price subscriptions only grow**: removing a symbol stops arbitrage tracking but never
   unsubscribes the exchange price/funding streams (only candles unsubscribe).
5. **Exchange badge never shows "down"**: sockets retry forever. Cells now show "stale", but the
   badge says "Connecting…" indefinitely.
6. Order book, trade prints: Binance only. Delta: no candles, no 24 h stats.
7. `SymbolService.getPopularSymbols()` still lists `MATIC`, `FTM` (rebranded/migrated).
8. `.idx/dev.nix` lists Svelte/Vue extensions; `package.json` name is `vite-project`.

## Dead code (delete in Phase 0)

- `src/components/OrderBookPanel.tsx` + `.module.scss`: an older duplicate; the app uses
  `src/components/dashboard/OrderBookPanel.tsx`. Accounts for 13 of the type errors.
- `src/utils/ators.ts`: unused re-export of `indicators.ts`.
- `src/custom-hooks/useCandles.ts`: not imported anywhere.
- `@electric-sql/pglite` dependency: unused (backend uses `node:sqlite`).

## History

- 2026-11-01 (this PR): context system (`CLAUDE.md`, `docs/`), product/architecture docs, build
  fix. My earlier dead-code removals were dropped in favour of master's newer code. `agent-docs/`
  was folded into these docs and deleted (see DECISIONS).
- 2026-10-24/25 (master `ad2c175`, `60bc1be`): charts, indicators, order book, alerts, Telegram +
  storage backend prototype, 191 tests. Committed as "code not reviewed".
- Angel One integration removed earlier (`4350c71`).
