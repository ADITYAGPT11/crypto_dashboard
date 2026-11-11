# Crypto Dashboard → Trade Confirmation System

Building an intelligent, research-driven trading system that generates **high-confidence trade
confirmations** from deep research, historical backtesting, forward testing, mathematical edge,
statistical probability, technical analysis, news impact and risk management.

**Current stage:** a React app over exchange public APIs (Binance, OKX, Delta Exchange India) and
a Python analysis service that detects chart and candlestick patterns, demand/supply zones and
order blocks, and measures how every setup has performed over one to two years. Live prices,
TradingView-style charts with a liquidity heatmap, pattern statistics, risk sizing and alerts.
Analysis only; no trade execution. See
[`docs/context/STATUS.md`](docs/context/STATUS.md) for what currently works and what's broken.

## Quick start

Requires Node 22.5+ and [uv](https://docs.astral.sh/uv/) (it installs Python 3.12 itself).

```bash
npm ci
npm start          # everything: web app, analysis service, Telegram prototype → http://localhost:3000
```

The first start downloads two years of history and measures every setup in the background
(about 15 minutes); the pages say "not measured yet" until then. Ctrl+C stops everything.

| Script              | What it does                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------ |
| `npm start`         | Web app + analysis service + Telegram prototype in one terminal (`--no-telegram` skips Telegram) |
| `npm run dev`       | Vite+ dev server on <http://localhost:3000>                                                      |
| `npm test`          | Unit tests (Vitest)                                                                              |
| `npm run check`     | Format + lint + type-check                                                                       |
| `npm run build`     | Type-check + production build into `dist/`                                                       |
| `npm run preview`   | Serve the production build                                                                       |
| `npm run backend`   | Bundle and start the backend prototype (Express + SQLite) on port 3001                           |
| `npm run api`       | Python analysis service (FastAPI) on port 8000 + background statistics                           |
| `npm run api:check` | Python format, lint, strict types and tests                                                      |

No API keys or `.env` are needed for the dashboard; only public exchange endpoints are used.

## Project context

- [`CLAUDE.md`](CLAUDE.md): entry point for AI-assisted work (guardrails, conventions, commands)
- [`docs/context/STATUS.md`](docs/context/STATUS.md): what works, what's broken, what's next
- [`docs/context/PROJECT_MAP.md`](docs/context/PROJECT_MAP.md): today's code: data flow, files, events
- [`docs/context/ARCHITECTURE.md`](docs/context/ARCHITECTURE.md): target architecture, folder structure, packages and tools
- [`docs/product/README.md`](docs/product/README.md): product vision and module specs with flowcharts
- [`docs/product/patterns.md`](docs/product/patterns.md): every pattern, zone and order-block rule and its source
- [`docs/context/ROADMAP.md`](docs/context/ROADMAP.md): phases from dashboard to confirmations
- [`docs/context/DECISIONS.md`](docs/context/DECISIONS.md): why things are the way they are
- [`docs/context/TOOLING.md`](docs/context/TOOLING.md): AI tools, reuse audit, alternatives considered
- [`docs/context/MINDMAP.md`](docs/context/MINDMAP.md): the whole project as a mind map

## Attribution

- Candlestick charts are built with [Lightweight Charts™](https://www.tradingview.com/lightweight-charts/)
  (Apache-2.0), Copyright (c) TradingView, Inc. In line with its licence, the TradingView
  attribution logo is displayed on every chart.
- Exchange data: Binance, OKX and Delta Exchange India public APIs.
