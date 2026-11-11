# Project map

What exists in code **today** (after the 2026-11-01 merge of master). The target system is in
`ARCHITECTURE.md`; the health of each part is in `STATUS.md`.

Stack: React 19 · TypeScript (strict) · Vite+ (`vp`: Vite, Vitest, oxlint, oxfmt) · SCSS ·
react-router 7 · eventemitter3 · lightweight-charts 5. **Analysis service: Python 3.12 + uv,
FastAPI, numpy, TA-Lib, httpx, SQLite** (`backend/`). Node prototype: Express + `node:sqlite`
(Telegram).

## Analysis service (`backend/`, Python)

One rule set; both the chart and the background statistics call `analysis/engine.py::analyze`.

- `common/`: `series.py` (column arrays, `head`/`scaled`/`mirror`), `timeframes.py`, `universe.py`
- `analysis/`: `catalog.py` (pattern ids, labels, sources, `RULESET_VERSION`), `indicators.py`
  (TA-Lib ATR/EMA/SMA), `swings.py` (pivots + `known_at`), `candlesticks.py` (TA-Lib shapes +
  context), `chart_patterns.py` (double bottom, inverse H&S, bull flag; twins by mirroring),
  `trendlines.py` (triangles, wedges), `zones.py`, `smc.py` (BOS/CHoCH, order blocks, FVG),
  `location.py`, `outcomes.py`, `stats.py` (Wilson, verdict), `engine.py`, `types.py`.
  Rules in words: `docs/product/patterns.md`.
- `marketdata/`: `binance.py` (REST klines + `data.binance.vision` zips, pacing, cooldown on
  refusal), `history.py` (`ensure`: archive months → archive days → REST tail; coverage/gaps)
- `store/sqlite.py`: candles, stats runs, setup stats, setup cases (WAL, swap per run)
- `jobs/stats_job.py`: per pattern TF, every coin, every allowed level TF; aggregates per coin
  and pooled, per location and any location
- `api/`: `app.py` (routes, scheduler in a worker process), `service.py`, `schemas.py`
  (camelCase models), `convert.py`, `ts_types.py` (generates `src/api/schema.ts`)
- `cli.py`: `tcs serve | stats | backfill | openapi | ts-types`
- `tests/`: invariants (no look-ahead, scale, determinism, mirror, levels known when formed),
  per-clause rules, golden snapshot (`fixtures/` real ETH 4h), API with a fake source

## Data flow (browser)

```mermaid
flowchart LR
  subgraph EX[Exchanges]
    WS["WebSockets<br/>Binance · OKX · Delta"]
    REST["REST<br/>symbols · 24h stats · candle history"]
  end

  WS --> AD["Adapters<br/>Binance · Okx · Delta"]
  AD -. uses .-> WSC["BaseWebSocketClient"]
  AD --> MDS["MarketDataService<br/>composition root"]

  MDS --> LIVE["LiveMarketDataService<br/>price + funding"]
  MDS --> ARB["ArbitrageService"]
  MDS --> OB["OrderBookService"]
  MDS --> TR["TradeService"]
  AD --> CS["CandleService"]
  REST --> CS
  REST --> TS["TickerStatsService"]
  REST --> SS["SymbolService"]
  OB --> LH["LiquidityHistoryService"]

  LIVE & CS & OB --> AL["AlertService<br/>2 s timer → AlertEngine"]

  LIVE --> H1["useLivePrice · useLiveFundingRate<br/>useDataFreshness"] --> PT["PriceTable"]
  TS --> H2["useTickerStats"] --> PT
  OB --> H3["useOrderBook"] --> OBP["OrderBookPanel"]
  TR --> H4["useTrades"] --> OBP
  ARB --> AP["ArbitragePanel"]
  AL --> ALP["AlertsPanel"]
  SS --> SRCH["SymbolSearch"]
```

`MainContainer` renders the panels in a user-ordered layout: metrics, connection status, chart,
price table, spread (arbitrage), order book, alerts.

## Files

**Entry / shell**

- `scripts/start.mjs` (`npm start`): runs `api`, `dev` and `backend` together, prefixed output,
  one failing never stops the others (except the web app), Ctrl+C stops the process trees

- `index.html` → `src/main.tsx` → `src/App.tsx`: `TopNav` + routes `/` (Dashboard),
  `/chart/:symbol` (Chart, lazy-loaded), `/markets` (older dashboard), `/about`
- `src/styles/tokens.css` (`--t-*` design tokens, dark), `src/styles/_page.scss` (page mixins)
- `src/components/MainContainer/`: dashboard; watchlist + panel layout state (persisted),
  starts streaming, renders panels in "Edit layout" order

**Exchange connectivity**

- `src/websocket/BaseWebSocketClient.ts`: reconnect/backoff/jitter, send queue, optional heartbeat
- `src/adapters/BinanceAdapter.ts`: combined streams; aggTrade (price + trade prints), bookTicker,
  depth20@100ms, klines + REST candle history, markPrice (funding)
- `src/adapters/OkxAdapter.ts`: tickers, funding-rate, candles + REST history
- `src/adapters/DeltaExchangeAdapter.ts`: trades, funding_rate (USD instruments mapped to `-USDT`)

**Services (singletons, `getInstance()` / `resetInstance()`)**

- `MarketDataService`: wires adapters → stores; `startMarketData`, `removeSymbol` (unsubscribes
  price/book/funding on all adapters and clears book/trade buckets)
- `LiveMarketDataService`: latest price/funding keyed `EXCHANGE|SYMBOL|TYPE`, per-key pub/sub
- `CandleService`: refcounted candle subscriptions, backfill, `loadMoreHistory` (scroll-back)
- `OrderBookService`, `LiquidityHistoryService`, `TradeService`: book snapshots, churn history,
  rolling trade prints
- `TickerStatsService`: 24 h change/volume via REST every 60 s
- `ArbitrageService`: cross-exchange last-price spread → `arbitrage` events
- `AlertEngine` (pure evaluation) + `AlertService` (live wiring, trigger log)
- `SymbolService`: REST symbol lists, search, popular list
- `MarketOverviewService`: Dashboard market data for the 10 research coins (Binance tickers,
  funding, OI, long/short; Fear & Greed; BTC dominance; liquidation stream); polls only while
  subscribed; each source `loading | ok | unavailable`
- `AnalysisApi` + `ApiResource`: the service's catalogue, analysis (refetched after each candle
  close), stats, setup detail and scanner as shared, auto-refreshing resources
- `LiquidityService`: Binance + OKX full-depth books (own sockets), sampled every 2 s while the
  heatmap is on
- `SetupAlertService`: setup-alert rules + firings (localStorage), 60 s check against the
  service's scanner, outcome tracking via its analysis, Telegram via the Node prototype
  `/api/alerts/send` (injectable deps for tests)

**Hooks**: `useAnalysisApi` (`useCatalog`, `useAnalysis`, `useStats`, `useSetupDetail`,
`useScanner`), `useUniverseCandles` (+ `researchUniverse`), `useLiquidity`, `useSetupAlerts`,
`useMarketOverview`, `useNow`, `useHistories` (one symbol, several TFs),
`useLiveCandle` (forming candle: Binance, OKX when Binance is silent; `utils/liveCandle`), `useLivePrice`, `useLiveFundingRate`, `useDataFreshness`, `useTickerStats`,
`useOrderBook`, `useTrades`, `useHistory`, `useConnectionSummary`

**Analysis in the browser**: none that feeds statistics (the service owns every rule). Display
helpers: `volumeProfile` (visible-range histogram, key volume levels), `timeframeMapping` (times
→ view positions for patterns, zones, blocks, gaps), `setupKeys` (`pattern|direction|location`,
labels, legacy-key upgrade), `patternLabels` (catalogue names), `setupLibrary` (stats map, filter,
sort, totals), `depthBook` (Binance snapshot+diff sync, OKX sequenced sync), `liquidityHeatmap`
(buckets, per-bar frames, pools), `overlaySettings` (layers + which levels are key; display
only, saved per browser). Types: `src/types/analysis.ts` wraps the generated
`src/api/schema.ts`; client `src/api/client.ts`.
`src/services/HistoryService.ts`: closed-candle history from Binance REST (fallback: the
service's `/api/v1/candles`) + `RESEARCH_UNIVERSE`.

**Pure utils (unit-tested in `src/utils/__tests__/`)**: `indicators`, `candleUtils`,
`orderBookUtils`, `symbolUtils` (parsing, leveraged-token filter, quote currency), `connectionState`
(close → connecting/down), `setupLibrary` (filter/sort/per-coin, setup-key parsing), `riskCalc`
(position sizing + remembered prefs), `setupAlerts` (rule matching, storage parsing, Telegram
payload), `marketStats` (volatility, ATR, trend, correlation, vol regime, sessions, movers,
bubble layout), `marketOverview` (source parsers, liquidation sums), `marketRows` (per-coin
rows), `timeframeMapping` (time → fractional view position, view patterns/levels), `detectionConfig`
(pattern TFs from the catalogue, level source), `indicatorRegistry` (chart indicators on `indicatorts`,
instances, parsing), `chartDisplay` (Heikin-Ashi, timeframe labels, chart prefs), `tickerStats`, `priceUtils`, `watchlistStorage`,
`layoutStorage`, `alertRulesStorage`. Adapter parsing and unsubscribe tests:
`src/adapters/__tests__/`.

**Types**: `src/types/marketData.ts` (market data, candles, trades, order book, exchange/market
names), `connection.ts`, `alertRules.ts`

**Brand**: `src/brand.ts` (product name and tagline in one place).

**UI components**: `TopNav/`, `DashboardPage/` (+ `MarketOverview/`: strip, `CoinSearch`,
`Connections`, `BubbleMap`, `Sentiment`, `MarketMonitor`, `Correlation`, `Liquidations`,
`Regime`, `Movers`, `DataHealth`), `StatsPage/`, `RiskPage/`, `AlertsPage/`,
`AlertToast/`, `ChartPage/` (`PriceChart` with panes/legend/drawings, `ChartToolbar`,
`DrawingToolbar`, `IndicatorsDialog`, `IndicatorSettings`, `Modal`, `icons`, `DetectionSettings`,
`TfBadge`, `SetupCard`, `LiquidityPanel`, `drawHeatmap`, `OverlaySettingsDialog`) (`PriceChart`: Lightweight Charts +
overlay canvas), `MainContainer/` (Markets), `dashboard/` (`PriceTable` → `PriceRow` →
`PriceCell`, `OrderBookPanel`, `Metrics`, `ConnectionStatus`), `ArbitragePanel/`, `AlertsPanel/`,
`AboutUs/`, `common-components/` (`Evidence`: Chip, CiBar, VerdictChip, Explain; `SymbolSearch`,
`RealTimeClock`)

**Backend prototype** (`src/backend/`, `npm run backend` bundles it to `dist-backend/` and starts it on port 3001; type-checked via `tsconfig.backend.json`)

- `index.ts`: Express: `/health`, Telegram config, alert send, history storage + replay endpoints
- `telegramService.ts`: rate-limited Telegram Bot API client
- `storage/database.ts` (`node:sqlite`, retention limits), `storage/replay.ts` (replay + rule tests)

## Events

| Event                                   | Emitted by                                 | Payload (see `src/types/`)                      |
| --------------------------------------- | ------------------------------------------ | ----------------------------------------------- |
| `marketData`                            | adapters → `MarketDataService`             | `GenericMarketData` (price in canonical symbol) |
| `fundingRate`                           | adapters → `MarketDataService`             | rate (%), next time (ms), interval (s)          |
| `connectionStatus`                      | adapters; `MarketDataService` (aggregated) | `{ exchange, market?, state }`                  |
| `candle`                                | adapters → `CandleService`                 | `Candle`                                        |
| `trade`                                 | `BinanceAdapter` → `TradeService`          | `TradeEvent`                                    |
| `orderBookSnapshot`, `orderBookBbo`     | `BinanceAdapter` → `OrderBookService`      | book levels / best bid-ask                      |
| `arbitrage`                             | `ArbitrageService`                         | spread per symbol                               |
| `trigger`, `rulesChanged`, `logChanged` | `AlertService`                             | alert firing / rule & log updates               |
| `symbolRemoved`                         | `MarketDataService`                        | symbol                                          |

## Endpoints used

- Binance WS: `wss://stream.binance.com:9443/stream`, `wss://fstream.binance.com/stream`
- Binance REST: `api.binance.com/api/v3/{exchangeInfo,klines,ticker/24hr}`,
  `fapi.binance.com/fapi/v1/{klines,ticker/24hr}`
- OKX WS: `wss://ws.okx.com:8443/ws/v5/public` (tickers, funding-rate, `candle*` channels)
- OKX REST: `www.okx.com/api/v5/{public/instruments,market/candles,market/ticker}`
- Delta India WS: `wss://public-socket.india.delta.exchange`
- Binance futures REST: `fapi.binance.com/fapi/v1/{ticker/24hr,premiumIndex}`,
  `/futures/data/{openInterestHist,globalLongShortAccountRatio}`; WS `fstream…/ws/!forceOrder@arr`
- `api.alternative.me/fng/?limit=8` (Fear & Greed), `api.coingecko.com/api/v3/global` (dominance)
- Telegram Bot API `api.telegram.org` (backend prototype only)
- Order books (heatmap): Binance `fstream…/stream?streams=<sym>@depth@500ms` + REST
  `fapi…/fapi/v1/depth?limit=1000`; OKX WS `books` channel (contract size from
  `public/instruments`)
- Analysis service (Python): Binance `fapi…/fapi/v1/klines`, `data.binance.vision`
  (monthly/daily kline zips)
- From the browser (dev proxy, `vite.config.ts`): `/api/v1/*` → `http://localhost:8000` (Python);
  other `/api/*` → `http://localhost:3001/*` (Node prototype)
