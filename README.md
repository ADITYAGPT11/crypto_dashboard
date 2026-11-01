# Crypto Dashboard → Trade Confirmation System

Building an intelligent, research-driven trading system that generates **high-confidence trade
confirmations** from deep research, historical backtesting, forward testing, mathematical edge,
statistical probability, technical analysis, news impact and risk management.

**Current stage:** live multi-exchange market-data dashboard (Binance, OKX, Delta Exchange India) —
spot & futures prices plus funding rates, streamed over WebSockets in the browser.

## Quick start

Requires Node 22+.

```bash
npm ci
npm run dev        # http://localhost:3000
```

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite+ dev server |
| `npm run build` | Type-check + production build into `dist/` |
| `npm run lint` / `lint:fix` | oxlint (type-aware) via Vite+ |
| `npm run preview` | Serve the production build |

No API keys or `.env` are needed — only public exchange endpoints are used.

## Project context

- [`CLAUDE.md`](CLAUDE.md) — entry point for AI-assisted work (conventions, commands, context rules)
- [`docs/context/STATUS.md`](docs/context/STATUS.md) — what works, what's broken, what was removed
- [`docs/context/PROJECT_MAP.md`](docs/context/PROJECT_MAP.md) — architecture, data flow, file index
- [`docs/context/ARCHITECTURE.md`](docs/context/ARCHITECTURE.md) — target architecture, folder structure, packages and tools
- [`docs/product/README.md`](docs/product/README.md) — product vision, architecture, module specs with flowcharts
- [`docs/context/TOOLING.md`](docs/context/TOOLING.md) — AI skills/agents/MCP servers and alternatives considered
- [`docs/context/ROADMAP.md`](docs/context/ROADMAP.md) — phases from dashboard to confirmations
- [`docs/context/MINDMAP.md`](docs/context/MINDMAP.md) — the whole project as a mind map
- [`docs/context/DECISIONS.md`](docs/context/DECISIONS.md) — why things are the way they are
