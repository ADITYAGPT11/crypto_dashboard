# Tooling: what to use and when

Curated for *this* product. Adopt a tool when its phase starts, not before. Fewer, well-understood
tools beat a big pile. Before installing anything, check its README, licence and last commit date.

## 1 · AI workflow (Claude Code)

| Tool | Use it for | When |
| --- | --- | --- |
| `CLAUDE.md` + `docs/context/` (this repo) | Fast, accurate session start | now |
| Built-in `/code-review`, `/security-review`, `/simplify` | Review every PR before merge | now |
| [anthropics/skills](https://github.com/anthropics/skills): `skill-creator` | Write our own project skills, e.g. "add an exchange adapter", "run a backtest + report" | once a task repeats 3× |
| [obra/superpowers](https://github.com/obra/superpowers) | Disciplined plan → TDD → debug workflow skills | P0 (when tests arrive) |
| [wshobson/agents](https://github.com/wshobson/agents) | Install **only** the relevant plugins (Python, data/quant, testing), not the whole marketplace | P1 |
| Awesome lists: [hesreallyhim/awesome-claude-code](https://github.com/hesreallyhim/awesome-claude-code), [travisvn/awesome-claude-skills](https://github.com/travisvn/awesome-claude-skills) | Discovery only | as needed |
| **CCXT MCP server** (official, `npx -y ccxt-mcp`) | Lets Claude query live market data across 100+ exchanges while researching; public data by default, trading opt-in | P1–P2 (keep it **read-only**) |
| GitHub MCP (already connected) | Issues/PRs as the task board | now |

Project skills worth writing (in `.claude/skills/`) as we go:
`new-exchange-adapter`, `backtest-report`, `strategy-gate-check`, `update-context`.

## 2 · Data & exchange connectivity

| Library | Why |
| --- | --- |
| **CCXT** (Python/JS) | Unified REST + WebSocket for 100+ exchanges; historical candles/funding for backfill |
| **DuckDB** + Parquet | Embedded analytical store; fast scans, zero ops |
| **Polars** (or pandas) | Fast dataframes for features |
| TimescaleDB / QuestDB | Only if we outgrow DuckDB |

## 3 · Research, backtesting, statistics

| Library | Role |
| --- | --- |
| **vectorbt** (open-source edition) | Fast vectorised screening of many parameter sets; *screen only*, it's weaker for complex order logic |
| **NautilusTrader** | Event-driven, production-grade engine where the same strategy code runs in backtest and live: candidate for M3/M4 parity |
| backtesting.py | Simple event-driven backtests; good for learning and quick validation |
| Freqtrade | Full crypto bot (backtest/paper/live); useful as a **reference** design, heavier to bend to our confirmation model |
| **pandas-ta** / **TA-Lib** | Technical indicators |
| **statsmodels**, **scipy** | Hypothesis tests, regressions, stationarity/cointegration (basis, pairs) |
| **arch** | GARCH volatility models (regime/vol filters) |
| **QuantStats** | Tear-sheet reports (Sharpe, Sortino, drawdowns, monthly returns) for strategy reports |
| **Optuna** | Parameter search; pair it with walk-forward to avoid overfitting |
| scikit-learn / LightGBM | Later: ML filters on top of rule-based signals |
| Riskfolio-Lib / skfolio | Later: portfolio-level risk and allocation |

Reading: *Advances in Financial Machine Learning* (López de Prado) for labelling, purged CV and the
deflated Sharpe ratio. These are the core anti-overfitting ideas behind the M3 gate.

## 4 · News & sentiment (P5)

| Tool | Role |
| --- | --- |
| CryptoPanic API, exchange announcement feeds, RSS | Sources |
| FinBERT (Hugging Face) or Claude API | Classification and sentiment |
| A public economic calendar | Macro event windows (FOMC, CPI, NFP) |

## 5 · Frontend & ops

| Tool | Role |
| --- | --- |
| TradingView **lightweight-charts** | Price/candle charts (free, Apache-2.0) |
| Vitest (via Vite+) | Frontend tests |
| pytest + hypothesis | Backend tests, property tests for the cost model and risk rules |
| GitHub Actions | CI: build, lint, tests on every PR |
| Docker Compose | Run collector + API + DB together |
| Telegram Bot API | Confirmation alerts |
