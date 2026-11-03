# Tooling: what to use and when

Curated for _this_ product. Adopt a tool when its phase starts, not before. Fewer, well-understood
tools beat a big pile. Before installing anything, check its README, licence and last commit date.

## 1 · AI workflow (Claude Code)

| Tool                                                                                                                                                                                        | Use it for                                                                                                         | When                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------- |
| `CLAUDE.md` + `docs/context/` (this repo)                                                                                                                                                   | Fast, accurate session start                                                                                       | now                           |
| Built-in `/code-review`, `/security-review`, `/simplify`                                                                                                                                    | Review every PR before merge                                                                                       | now                           |
| [anthropics/skills](https://github.com/anthropics/skills): `skill-creator`                                                                                                                  | Write our own project skills, e.g. "add an exchange adapter", "run a backtest + report"                            | once a task repeats 3×        |
| [obra/superpowers](https://github.com/obra/superpowers)                                                                                                                                     | Disciplined plan → TDD → debug workflow skills                                                                     | P0 (when tests arrive)        |
| [wshobson/agents](https://github.com/wshobson/agents)                                                                                                                                       | Install **only** the relevant plugins (Python, data/quant, testing), not the whole marketplace                     | P1                            |
| Awesome lists: [hesreallyhim/awesome-claude-code](https://github.com/hesreallyhim/awesome-claude-code), [travisvn/awesome-claude-skills](https://github.com/travisvn/awesome-claude-skills) | Discovery only                                                                                                     | as needed                     |
| **CCXT MCP server** (official, `npx -y ccxt-mcp`)                                                                                                                                           | Lets Claude query live market data across 100+ exchanges while researching; public data by default, trading opt-in | P1–P2 (keep it **read-only**) |
| GitHub MCP (already connected)                                                                                                                                                              | Issues/PRs as the task board                                                                                       | now                           |

Project skills worth writing (in `.claude/skills/`) as we go:
`new-exchange-adapter`, `backtest-report`, `strategy-gate-check`, `update-context`.

## 2 · Chosen stack

The chosen packages and tools, per folder and phase, live in **`ARCHITECTURE.md` §4–5**.
This file keeps AI tooling and the alternatives we considered.

## 3 · Alternatives considered (not adopted now)

| Option                   | Instead of                  | Revisit when                                                |
| ------------------------ | --------------------------- | ----------------------------------------------------------- |
| TimescaleDB / PostgreSQL | QuestDB-only                | append-only app data gets awkward (P3)                      |
| ClickHouse               | QuestDB for ticks           | storing full trade history at billions of rows              |
| NautilusTrader           | own event-driven backtester | decide at the start of P2 (Rust core, live/backtest parity) |
| backtesting.py           | own event-driven backtester | quick learning/validation experiments                       |
| Freqtrade                | building our own pipeline   | reference design only; doesn't fit the confirmation model   |
| Riskfolio-Lib / skfolio  | simple risk limits          | portfolio-level allocation (after P6)                       |
| scikit-learn / LightGBM  | rule-based signals          | ML _filters_ on proven signals (after P4)                   |
| NATS / Redis Streams     | in-process event bus        | backend splits into several processes                       |
| CryptoPanic API, FinBERT | —                           | news sources/classifier choice at P5                        |

## 4 · Reuse audit (mandatory before adding a dependency or copying code)

Check licence, recent activity, tests/CI, security and fit. Decisions: **REUSE AS DEPENDENCY** /
**ADAPT COMPONENT** / **REFERENCE ONLY** / **REJECT**. No licence means reference only.
Audited 2026-10-24 via the GitHub API (re-verify before adopting).

| Project                                                                                       | Licence             | Decision                                                                     |
| --------------------------------------------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------- |
| [voidzero-dev/vite-plus](https://github.com/voidzero-dev/vite-plus)                           | bundled w/ npm dist | **Reuse**: project toolchain (v1.3.0)                                        |
| [tradingview/lightweight-charts](https://github.com/tradingview/lightweight-charts)           | Apache-2.0          | **Reuse**: charts; TradingView attribution required (README + on-chart logo) |
| [ccxt/ccxt](https://github.com/ccxt/ccxt)                                                     | MIT                 | Browser: reference only (native WS used). **Python backend: reuse** (P1)     |
| [bennycode/trading-signals](https://github.com/bennycode/trading-signals)                     | none detected       | **Reference only**: indicators written in-house (`src/utils/indicators.ts`)  |
| [nazmiefearmutcu/flowmap](https://github.com/nazmiefearmutcu/flowmap)                         | Apache-2.0          | **Adapt (candidate)**: WebGL2 heatmap renderer; young repo, review first     |
| [FIQTOR/cryptopulse](https://github.com/FIQTOR/cryptopulse)                                   | MIT                 | Reference only: too young                                                    |
| [AIUngated/crypto-liquidity-terminal](https://github.com/AIUngated/crypto-liquidity-terminal) | MIT                 | Reference only: stale, different stack                                       |

Add a row here **before** adding any new dependency.

### Free data sources (no key, no dependency)

| Source                                                                                 | Used for                                                                               | Terms / limits                                                | Notes                                                                                  |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Binance USDⓈ-M public REST (`fapi.binance.com`)                                        | 24h tickers, funding (`premiumIndex`), open interest history, long/short ratio, klines | Public endpoints, IP weight limits                            | Polled every 30 s / 5 min for 10 coins only                                            |
| Binance `!forceOrder@arr` stream                                                       | Liquidations                                                                           | At most one order per symbol per second, so totals undercount | Labelled as an undercount in the UI                                                    |
| [alternative.me Fear & Greed API](https://alternative.me/crypto/fear-and-greed-index/) | Fear & Greed Index                                                                     | Free, no key; attribution asked for                           | Polled every 30 min; source named next to the gauge. Not verified from the dev sandbox |
| CoinGecko `/api/v3/global` (free tier)                                                 | BTC dominance                                                                          | Public tier, tight rate limit                                 | Polled every 10 min. Not verified from the dev sandbox                                 |

Reading: _Advances in Financial Machine Learning_ (López de Prado) for labelling, purged CV and the
deflated Sharpe ratio. These are the core anti-overfitting ideas behind the M3 gate.
