# Project map

What exists in code **today** (after the 2026-11-01 merge of master). The target system is in
`ARCHITECTURE.md`; the health of each part is in `STATUS.md`. A clickable version of this map is
the app's **Tech overview** (`/tech-overview`, data in `src/components/TechOverviewPage/maps.ts`);
update it when modules or flows move (its tests fail when a listed file disappears).

Stack: React 19 · TypeScript (strict) · Vite+ (`vp`: Vite, Vitest, oxlint, oxfmt) · SCSS ·
react-router 7 · eventemitter3 · lightweight-charts 5. **Analysis service: Python 3.12 + uv,
FastAPI, numpy, TA-Lib, httpx, SQLite** (`backend/`). Node prototype: Express + `node:sqlite`
(Telegram).

## Analysis service (`backend/`, Python)

One rule set; both the chart and the background statistics call `analysis/engine.py::analyze`.

- `common/`: `series.py` (column arrays incl. taker buy volume, `head`/`scaled`/`mirror`), `timeframes.py`, `universe.py`
- `analysis/`: `catalog.py` (pattern ids, labels, sources, `RULESET_VERSION`), `indicators.py`
  (TA-Lib ATR/EMA/SMA), `swings.py` (pivots + `known_at`), `candlesticks.py` (in-house shapes,
  trend, confirmation; twins by mirroring), `chart_patterns.py` (double bottom, inverse H&S, bull
  flag; prior trend; twins by mirroring),
  `mirroring.py` (bearish twins back to real prices, labels flipped: Bottom ↔ Top, Upper ↔ Lower),
  `trendlines.py` (triangles, wedges), `zones.py`, `smc.py` (BOS/CHoCH, order blocks, FVG),
  `location.py`, `outcomes.py` (trade plan: TP1 then a trailing stop, strict 5-minute fills), `plan.py` (1h stop buffer, cost filter), `costs.py` (fees, slippage,
  funding → R per case), `flow.py` (order-flow context: delta, CVD divergence), `confidence.py` (score 0-4 → the
  chart's confidence %), `stats.py`
  (Wilson, after-cost break-even, expectancy, verdict), `engine.py`, `types.py`.
  Rules in words: `docs/product/patterns.md`.
- `marketdata/`: `binance.py` (REST klines and funding + `data.binance.vision` zips, pacing,
  cooldown on refusal), `history.py` (`ensure`: archive months → archive days → REST tail;
  coverage/gaps; `ensure_funding`: archive months → REST tail)
- `depth/`: `books.py` (Binance / OKX book sync, port of `depthBook.ts`), `sampler.py` (books →
  one-minute bucket columns), `recorder.py` (`DepthRecorder`: per-symbol sockets with reconnect,
  2 s sampling, started in the API lifespan; `TCS_DEPTH_RECORD`, `TCS_DEPTH_SYMBOLS`,
  `TCS_DEPTH_DAYS`)
- `store/sqlite.py`: candles, funding rates (+ fetched months), stats runs, setup stats (per
  order-flow context), setup cases,
  depth columns (WAL, swap per run)
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
  `/chart/:symbol` (Chart, lazy-loaded), `/markets` (older dashboard), `/tech-overview` and
  `/tech-overview/:mapId` (architecture maps, lazy-loaded), `/about`
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
- `LiquidityService`: Binance + OKX + Delta books (own sockets) plus OKX's 5 000-level REST
  book every 5 s for the far levels, added up within ±2% of the mid and sampled every 2 s while
  the heatmap is on; per-exchange state and share
- `SetupAlertService`: setup-alert rules + firings (localStorage), 60 s check against the
  service's scanner, outcome tracking via its analysis, Telegram via the Node prototype
  `/api/alerts/send` (injectable deps for tests)

**Hooks**: `useAnalysisApi` (`useCatalog`, `useAnalysis`, `useStats`, `useCoinStats` (`/stats?symbol=`), `useSetupDetail`,
`useScanner`), `useUniverseCandles` (+ `researchUniverse`), `useLiquidity`, `useSetupAlerts`,
`useMarketOverview`, `useNow`, `useHistories` (one symbol, several TFs),
`useDepthHistory` (recorded heatmap minutes from `/api/v1/depth`, once per enable),
`useFootprint` (live footprint per view bar and row size; session trade buffer per symbol),
`useBigTrades` (big Binance perp taker orders, merged from aggTrade, top 1% of recent prints, ≤ 2
renders/s), `useLiveCandle` (forming candle: Binance, OKX when Binance is silent; `utils/liveCandle`), `useLivePrice`, `useLiveFundingRate`, `useDataFreshness`, `useTickerStats`,
`useOrderBook`, `useTrades`, `useHistory`, `useConnectionSummary`

**Analysis in the browser**: none that feeds statistics (the service owns every rule). Display
helpers: `volumeProfile` (visible-range histogram, POC / value area), `timeframeMapping` (times
→ view positions for patterns, zones, blocks, gaps), `patternGeometry` (how a selected pattern is
drawn: shaded formation, necklines/trendlines, key-point tags, measured move, position box), `setupKeys` (`pattern|direction|location`,
labels, legacy-key upgrade), `patternLabels` (catalogue names), `setupLibrary` (stats map, filter,
sort, totals), `patternGroups` (chart detections → one row per pattern and direction), `depthBook` (Binance snapshot+diff sync, OKX sequenced sync, OKX full book, `farBook`, Delta
`l2_orderbook`), `liquidityHeatmap`
(buckets, samples, pools, recorded columns → samples, history + live merge), `heatmapRender`
(thermal palette, contrast, snapshots → pixel buffer), `orderFlow` (delta, CVD, `BigTradeDetector`, time → bar
position), `footprint`
(rows, `FootprintBook`, diagonal imbalance), `overlaySettings` (layers + which levels are key; display
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
(timeframes and patterns per direction picked in the Patterns panel; chart on, candlesticks off by default), `indicatorRegistry` (chart indicators on `indicatorts`,
instances, parsing), `chartDisplay` (Heikin-Ashi, timeframe labels, chart prefs), `tickerStats`, `priceUtils`, `watchlistStorage`,
`layoutStorage`, `alertRulesStorage`. Adapter parsing and unsubscribe tests:
`src/adapters/__tests__/`.

**Types**: `src/types/marketData.ts` (market data, candles, trades, order book, exchange/market
names), `connection.ts`, `alertRules.ts`

**Brand**: `src/brand.ts` (GreenMTM name, wordmark parts, logo path) + `public/greenmtm.svg`
(logo and favicon); colour `--t-brand` in `tokens.css`.

**Tech overview** (`TechOverviewPage/`): `maps.ts` (the overview + 8 detail maps: nodes, edges,
files, flows; each box with `detail` opens that map), `ArchDiagram` (SVG edges + positioned boxes,
scaled to fit), the page (breadcrumb, `?flow=` highlight, side panel with files and links).
Layout, edge routing, highlight sets and `validateMaps` are pure in `src/utils/archMap.ts`.

**UI components**: `TopNav/`, `DashboardPage/` (+ `MarketOverview/`: strip, `CoinSearch`,
`Connections`, `BubbleMap`, `Sentiment`, `MarketMonitor`, `Correlation`, `Liquidations`,
`Regime`, `Movers`, `DataHealth`), `StatsPage/`, `RiskPage/`, `AlertsPage/`,
`AlertToast/`, `ChartPage/` (`PriceChart` with panes/legend/drawings, `ChartToolbar`,
`DrawingToolbar`, `IndicatorsDialog`, `IndicatorSettings`, `Modal`, `icons`, `DetectionSettings`
(Patterns popover in the toolbar), `TfBadge`, `PatternRows` (rows under the chart), `WatchlistStrip`, `LiquidityPanel`, `drawPattern`, `drawHeatmap`, `drawBigTrades`, `drawFootprint`, `OverlaySettingsDialog`) (`PriceChart`: Lightweight Charts +
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

- Binance WS: spot `wss://stream.binance.com:443/stream`; futures `wss://fstream.binance.com/public/stream`
  (depth, bookTicker) and `/market/stream` (aggTrade, kline, markPrice): split since March 2026
- Binance REST: `api.binance.com/api/v3/{exchangeInfo,klines,ticker/24hr}`,
  `fapi.binance.com/fapi/v1/{klines,ticker/24hr}`
- OKX WS: `wss://ws.okx.com/ws/v5/public` (port 443; 8443 is often blocked by proxies) (tickers, funding-rate, `candle*` channels)
- OKX REST: `www.okx.com/api/v5/{public/instruments,market/candles,market/ticker,market/books-full}`
- Delta India WS: `wss://public-socket.india.delta.exchange` (trades, funding only);
  `wss://socket.india.delta.exchange` (`l2_orderbook`, heatmap); REST `api.india.delta.exchange/v2/products/{symbol}`
- Binance futures REST: `fapi.binance.com/fapi/v1/{ticker/24hr,premiumIndex}`,
  `/futures/data/{openInterestHist,globalLongShortAccountRatio}`; WS `fstream…/market/ws/!forceOrder@arr`
- `api.alternative.me/fng/?limit=8` (Fear & Greed), `api.coingecko.com/api/v3/global` (dominance)
- Telegram Bot API `api.telegram.org` (backend prototype only)
- Order books (heatmap): Binance `fstream…/public/stream?streams=<sym>@depth@500ms` + REST
  `fapi…/fapi/v1/depth?limit=1000`; OKX WS `books` channel (contract size from
  `public/instruments`)
- Analysis service (Python): Binance `fapi…/fapi/v1/klines`, `data.binance.vision`
  (monthly/daily kline zips)
- From the browser (dev proxy, `vite.config.ts`): `/api/v1/*` → `http://localhost:8000` (Python);
  other `/api/*` → `http://localhost:3001/*` (Node prototype)
