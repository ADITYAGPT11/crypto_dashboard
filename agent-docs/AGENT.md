# AGENT.md — AI Agent Guide for the Free Real-Time Market Analysis Tool

Read this file **before changing any code**. It gives you the full context: what the project is,
how it is structured, what is done, what is next, and the rules you must follow.

All agent docs live together in this `agent-docs/` folder. The authoritative roadmap lives in
`projectNotes.txt` (module-by-module checklist, priority order, scope guardrails). This guide
summarizes and cross-references it; when the two disagree, `projectNotes.txt` wins. Reuse
decisions are documented in `OPEN_SOURCE_REUSE.md`.

---

## 1. What this project is

A **free-first crypto market-analysis platform** — analysis only, never trade execution.

- Live prices, funding rates and connection status streamed from **exchange public WebSocket APIs**
  (no API keys, no paid feeds).
- Charts, order-book/flow analytics, liquidity heatmap, derivatives stats and alerts are added
  module by module per the roadmap.
- Baseline target: **local / self-hosted use**. Public deployment only after free-tier and
  redistribution-terms review.

**Hard rules (from-projectNotes guardrails — do not violate):**

1. No trade execution, no order placement, no auto-trading in this scope.
2. No paid services, no market-data API keys, no trading/execution endpoints unless the user
   explicitly approves.
3. Public feeds cannot identify order owners and visible large orders can be spoofed — always
   present observed data as observations, distinguish from estimates, and label limitations.
4. Never claim the tool predicts price or guarantees an edge.

---

## 2. Tech stack & toolchain

| Concern                 | Choice                                                              |
| ----------------------- | ------------------------------------------------------------------- |
| Language                | TypeScript end-to-end, strongly typed                               |
| Frontend                | React 19 (Vite+ template)                                           |
| Toolchain               | **Vite+ (`vp`)** — the unified toolchain, _not_ plain-Vite commands |
| Charts (planned)        | TradingView Lightweight Charts (Apache-2.0 + attribution)           |
| Styling                 | SCSS modules (`*.module.scss`) + shared `.scss`                     |
| Event plumbing          | `eventemitter3`                                                     |
| Testing                 | `vp test` (Vitest is built into Vite+)                              |
| Backend/SQLite/Telegram | **Module 7 started** (Telegram service + Express backend)           |

### Commands (use these, in this order, before declaring a module done)

```bash
npm install        # after pulling changes or adding a dependency
npm run dev        # dev server on http://localhost:3000
vp check           # format + lint + typecheck in one shot; fixes nothing
vp check --fix     # auto-fix formatting/lint
vp test            # Vitest run (expect exit 0; "No test files found" is exit 1 → add tests)
vp build           # production build
```

`vp` CLI reference: `vp help`. Vite+ guide: https://viteplus.dev/guide

---

## 3. Architecture (as built today)

```
Exchange public WS API
      │
      └── <Exchange>Adapter (src/adapters/*)   EventEmitter: emits
            ├─ "marketData"  → GenericMarketData
            ├─ "fundingRate" → funding-rate payload
            └─ "connectionStatus" → ConnectionStatusPayload
                          │
                  MarketDataService (singleton, src/services/MarketDataService.ts)
                  wires adapters, fans out events, aggregates per-exchange
                  connection state (live/connecting/down)
                          │
                  LiveMarketDataService (singleton, src/services/LiveMarketDataService.ts)
                  keyed store: `exchange|symbol|type` → latest price / FundingRateSnapshot
                  + per-key listener sets
                          │
                  React UI via subscribe callbacks
                  custom hooks: useLivePrice, useLiveFundingRate
                  dashboard: MainContainer → Metrics, ConnectionStatus, PriceTable, ArbitragePanel
```

Key invariants:

- **Canonical symbol format is `BASE-QUOTE` with `USDT` quote** (e.g. `BTC-USDT`) everywhere
  inside the app — UI, service keys, subscription calls. Adapters normalize exchange-native
  symbols (`BTCUSDT`, `BTC-USD`, `BTCUSDT-SWAP`, Delta `BTCUSD`) to canonical on ingest.
- Adapters never leak exchange-native fields into services/UI: they emit the normalized types in
  `src/types/marketData.ts` and `src/types/connection.ts`.
- Service singletons: `MarketDataService`, `LiveMarketDataService`, `SymbolService` all use
  `getInstance()` (and `resetInstance()` where tests will need it).
  `MarketDataService.startMarketData(symbols)` is idempotent for connection setup but re-subscribes.
- Every exchange connects independently; a failing handshake on one exchange must never block the
  others. Adapters re-send tracked subscriptions after every reconnect (send queue in
  `BaseWebSocketClient` buffers payloads until the socket opens).

### Current exchange coverage

| Exchange             | Markets   | Streams wired                                    | Notes                                     |
| -------------------- | --------- | ------------------------------------------------ | ----------------------------------------- |
| Binance              | SPOT+FUT  | aggTrade, depth (raw, unused), markPrice/funding | subscribes both markets with same streams |
| OKX                  | SPOT+SWAP | tickers, funding-rate                            | SWAP suffixed `-SWAP` at subscription     |
| Delta Exchange India | FUT       | trades, funding_rate                             | USD-quoted instruments mapped to USDT     |

---

## 4. Folder structure & conventions

```
src/
  adapters/            one class per exchange, extends EventEmitter
  websocket/           BaseWebSocketClient — reconnect/backoff/jitter, heartbeat, send queue;
                       ALL adapters must go through it, never raw `new WebSocket`
  services/            MarketDataService (composition root), LiveMarketDataService (store),
                       SymbolService (REST symbol lists from exchange public APIs)
  types/               shared contracts — keep small and additive
  utils/               pure functions (symbol normalization) — these must be unit-tested
  custom-hooks/        React hooks over the service singletons
  components/          UI widgets (dashboard/, Header/, ArbitragePanel/, ...)
  common-components/   cross-screen widgets (SymbolSearch, RealTimeClock)
  MainContainer/       dashboard page shell
```

Rules of thumb:

- New pure logic → `src/utils/<file>.ts` (+ a `.test.ts` next to it, run by `vp test`).
- New shared data flow → a service class with getters + `subscribe()` returning an unsubscribe
  function; expose a tiny React hook in `custom-hooks/`. Follow the existing
  `forceUpdate`-on-notify pattern in `useLivePrice.ts`.
- Never call `console.*` from UI components; adapter/service code logs errors at its own boundary.
- Formatting/lint: `vp check --fix` before finishing; keep changes small and modular, and do not
  rewrite working modules without a clear reason (roadmap guideline).

---

## 5. Current status (as of 2026-10-25)

- ✅ **Module 0 (foundation)** — Vite+ 1.3.0 + React 19 + TS; `vp check` clean; `npm run dev` runs.
- ✅ **Module 1 (contracts)** — `GenericMarketData`, `CanonicalSymbol`, `ConnectionState`,
  funding snapshots normalized; symbol normalization in `src/utils/symbolUtils.ts`.
- ✅ **Module 2 (exchange adapters & live pipeline)** — three adapters over
  `BaseWebSocketClient` (auto-reconnect w/ exponential backoff + jitter, buffered subscriptions,
  optional heartbeat), funding-rate streams on Binance/OKX/Delta, per-exchange aggregated status
  surfaced in the UI.
- ✅ **Module 3 (dashboard)** — price table, connection status, symbol search, metrics exist;
  **2026-10-24**: cross-exchange last-price spread engine wired into the
  (previously dead) `arbitrage` event, stale-data warnings + last-update timestamps in the price
  table, per-symbol-minus/removal behavior verified, and **watchlist persistence** added —
  tracked symbols survive refresh via localStorage (`src/utils/watchlistStorage.ts`, validated
  and unit-tested). Removed symbols now drop out of arbitrage tracking
  (`MarketDataService.removeSymbol` → `ArbitrageService.forgetSymbol`).
  **2026-10-25: Module 3 checklist complete** — (a) per-cell **24h change% + base volume** rows
  added via `TickerStatsService` (REST-polled exchange 24h rollups, 60s cadence; Binance
  spot/futures + OKX; Delta has no wired source; `updatedAt` surfaced for honesty), and
  (b) **widget layout customization**: an “Edit layout” mode in `MainContainer` with reorder
  (↑/↓) and show/hide (◉/○) chips per panel, persisted as `{id, visible}` entries in
  localStorage via `src/utils/layoutStorage.ts` (validated, unit-tested; hidden panels stay
  hidden across reloads).
- ✅ **Module 4 (charting & indicators)** — implemented 2026-10-24: `lightweight-charts@5.2.1`
  (Apache-2.0, attribution in README + on-chart logo). Candle pipeline: `Candle`/`CandleInterval`
  contracts in `src/types/marketData.ts`; kline WS streams + REST backfill (1000 candles —
  Binance single 1000-row request, OKX paged 300/req) on Binance spot/futures and OKX spot/swap
  via `src/services/CandleService.ts` (refcounted subscriptions, in-place ascending buffers,
  max 5000 candles); `useCandles` hook; `ChartPanel` (symbol/source/interval selectors, volume
  histogram, magnet crosshair, built-in pan/zoom + autoSize). 2026-10-25: TradingView-style
  scroll-back — scrolling near the left edge loads older pages (Binance `endTime`, OKX `after`
  cursor) via `CandleService.loadMoreHistory` (in-flight + exhaustion guards, visible view
  anchored during prepends). Indicators EMA/SMA/RSI/MACD/VWAP/Bollinger/ATR are pure functions
  in `src/utils/indicators.ts` (14 unit tests); RSI/ATR/MACD get their own panes; ＋ Indicators
  dropdown picker + removable chips; params editable; loading/backfill-failure/insufficient-
  candle overlay states. Limitations: Delta has no candle source yet; VWAP resets per UTC day
  over the loaded window; no drawing tools; no persisted history/replay.
- ✅ **Module 5 (order book & order-flow)** — completed 2026-10-25: partial-book
  `@depth20@100ms` stream → `OrderBookService` → rebuilt `OrderBookPanel` (TradingView-style
  cumulative depth bars behind ladder rows, BBO + spread/spread%, imbalance pressure with
  configurable top-N, large-order level highlighting, ▲/▼ liquidity-churn arrows via
  `diffDepthByLevel`/`churnMapByPrice`, freshness label, settings row). Trade prints:
  `BinanceAdapter` emits `TradeEvent`s from `aggTrade` → `TradeService` rolling store (250/key)
  → `useTrades` → "Large prints" list with configurable threshold + buy/sell side. Limitation
  labels in the panel (visible liquidity only, no order owners, spoofing risk, churn cannot
  separate cancels from fills). OKX/Delta trade sources not wired yet.
- ✅ **Module 6 (alert rules)** — completed 2026-10-25: `src/types/alertRules.ts` (serializable
  rule format), `src/services/AlertEngine.ts` (pure deterministic evaluation: priceCross /
  percentMove / volumeSpike / indicatorThreshold (RSI·SMA·EMA) / bookImbalance /
  largeLiquidity; ALL/ANY combine; cooldownMs as cooldown + dedupe; enabled flag;
  candle_close vs intrabar semantics per rule), `alertRulesStorage` (localStorage rules +
  capped trigger log with {firedAt, values, reason}). Live wiring: `AlertService` singleton —
  2s evaluation timer assembling `AlertEngineContext` from CandleService/OrderBookService/
  LiveMarketDataService (prev-price map for cross detection), persisted trigger log, "trigger" /
  "rulesChanged" / "logChanged" events. UI: `AlertsPanel` (layout panel id `alerts`) — rule
  list with enable/disable/delete, multi-condition builder for all six condition kinds,
  recent-trigger log. Replay-tested (18 tests: crossing-only semantics, cooldown suppression,
  deterministic rerun, target discovery).
- ✅ **Module 7 (Telegram alert delivery)** — Started: `src/backend/telegramService.ts` (rate-limited Telegram Bot API client with retries, formatted alert messages) + `src/backend/index.ts` (Express server with `/health`, `/telegram/config`, `/alerts/send` endpoints). `express` added to dependencies. Remaining: bot token setup, testing, per-rule notification settings.
- ⬜ Modules 8 (history/replay — needs SQLite),
  9 (heatmap), 10 (derivatives/stats), 11 (reliability/release) — **not started**.
- Tests (2026-10-25): 191 passing across 9 files under `vp test` — `watchlistStorage` (15),
  `candleUtils` (15), `indicators` (14), `symbolUtils` (25), adapter message-parsing (34),
  `orderBookUtils` (41, incl. level-diff churn + large-print filters), `layoutStorage` (8+14),
  `tickerStats` + formatters (10+5), `alertEngine` replay + target discovery (18).

### Known gaps / debt to keep in mind

- The Binance/OKX symbol list filters (`includes("UP")` etc.) are crude substring filters — refine
  when the symbol universe matters.
- `BinanceAdapter` (rebuilt 2026-10-25) subscribes the same per-symbol streams to both spot and
  futures sockets; last price comes from `aggTrade` only, and `bookTicker` feeds the BBO.
  Partial-book depth (`@depth20@100ms`) shows the top-20 visible levels only — not full depth;
  order-ladder metrics must keep the "visible liquidity only" caveat.
- OKX and Delta REST hosts are unreachable from the dev host (verified via curl 2026-10-25), so
  OKX 24h stats / candle backfill degrade gracefully; Binance REST works.
- Delta has no 24h stats source and no candle source wired yet; Delta cells simply show no stats
  row instead of a placeholder.
- Delta Exchange India WSS is flaky; it degrades gracefully but expect `connecting` often.
- No backend, SQLite, alert engine, or server persistence yet — the app is currently client-only
  (watchlist persists in browser localStorage only).
- `dist/` in the repo is stale build output; don't treat as source.

## 6. When you finish a change

1. `vp check` → must be clean.
2. `vp test` → must pass (`No test files found` is treated as failure; add tests for any new pure logic).
3. `vp build` → must succeed.
4. Update `projectNotes.txt` module checklist + the "Current status" section.
5. Update this file's status section if the build/roadmap state changed.
6. Any third-party library added → add the decision to `OPEN_SOURCE_REUSE.md` first.
