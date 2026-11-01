# Project status

_Last verified: 2026-11-01 · branch `claude/amazing-gauss-eyr3t5`_

## Phase

**Phase 0 — Live market data layer** (see `ROADMAP.md`). No signals, history, backtests or
trading logic exist yet.

## Next up (todo pointer, details in `ROADMAP.md` → Phase 0)

1. Fix symbol filter (issue 2) → 2. Unsubscribe on removal (3) → 3. Stale/down detection (5)
→ 4. Delta USD labelling + funding units (1, 6) → 5. Vitest + GitHub Actions CI.

## Health

| Check | State |
| --- | --- |
| `npm run build` | ✅ passes (was failing on Linux until 2026-11-01 — `index.html` pointed at `/src/Main.tsx`) |
| `npm run lint` | ✅ clean |
| Tests | ❌ none — no test runner configured |
| Backend / persistence | ❌ none — everything runs in the browser, nothing is stored |

## What works

- Live **last-trade price** per symbol × exchange × market:
  - Binance spot + USDⓈ-M futures (`aggTrade`), OKX spot + perpetual swap (`tickers`),
    Delta India perpetuals (`trades`).
- Live **funding rate**, interval and countdown to next funding (Binance `markPrice`,
  OKX `funding-rate`, Delta `funding_rate`).
- Per-exchange **connection badge** (connecting / live), auto-reconnect with backoff + jitter,
  subscriptions re-sent on reconnect.
- **Symbol search** (Binance + OKX USDT spot lists via REST) to add/remove symbols.
- Light/dark theme, header clock, `/about` route.

## Known issues (not fixed yet — pick up from here)

1. **Delta is USD-quoted, shown as USDT.** `BTC-USDT` → `BTCUSD` on subscribe and normalised back
   to `-USDT` (`src/adapters/DeltaExchangeAdapter.ts`). Prices are comparable-ish but not the same
   instrument; any spread/basis math must account for USD vs USDT.
2. **Symbol filter drops real coins.** `SymbolService` excludes any symbol containing `UP`/`DOWN`/
   `BULL`/`BEAR` as substrings — this hides e.g. `JUP-USDT`, `SUPER-USDT`.
3. **Subscriptions only grow.** Removing a symbol hides the row but never unsubscribes the
   exchange streams.
4. **Stale popular list.** `getPopularSymbols()` still lists `MATIC`, `FTM` (rebranded/migrated).
5. **"down" state is never emitted** — sockets retry forever, so a dead exchange shows
   "Connecting…" indefinitely. No staleness detection (heartbeat option exists but is off).
6. **Delta funding-rate units unverified** — Binance/OKX are ×100 to percent; Delta's `fr` is used
   as-is on the assumption it's already percent. Confirm against Delta docs before using it in math.
7. `.idx/dev.nix` (Firebase Studio) still lists Svelte/Vue extensions; harmless leftover.
8. `package.json` name is still `vite-project`.

## Removed in the 2026-11-01 cleanup (recoverable from git history)

- `ArbitragePanel` + `ArbitrageOpportunity` type — nothing ever emitted `"arbitrage"`, so the panel
  permanently claimed "No arbitrage opportunities detected". Re-introduce when a real spread
  engine exists (ROADMAP Phase 3).
- Binance `depth` stream subscription — data was received and discarded.
- `PriceTable` skeleton branch (`hasData` was hard-coded `true`), `parseBinanceSymbol`,
  `MarketDataService.resetInstance`, `SymbolService.getAllSymbols` — all unused.
- Template README boilerplate and the reference to a non-existent `.env.example`.
- Angel One integration was removed earlier (commit `4350c71`).
