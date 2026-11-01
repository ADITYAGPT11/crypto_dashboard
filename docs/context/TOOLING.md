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

## 2 · Chosen stack

The chosen packages and tools, per folder and phase, live in **`ARCHITECTURE.md` §4–5**.
This file keeps AI tooling and the alternatives we considered.

## 3 · Alternatives considered (not adopted now)

| Option | Instead of | Revisit when |
| --- | --- | --- |
| TimescaleDB / PostgreSQL | QuestDB-only | append-only app data gets awkward (P3) |
| ClickHouse | QuestDB for ticks | storing full trade history at billions of rows |
| NautilusTrader | own event-driven backtester | decide at the start of P2 (Rust core, live/backtest parity) |
| backtesting.py | own event-driven backtester | quick learning/validation experiments |
| Freqtrade | building our own pipeline | reference design only; doesn't fit the confirmation model |
| Riskfolio-Lib / skfolio | simple risk limits | portfolio-level allocation (after P6) |
| scikit-learn / LightGBM | rule-based signals | ML *filters* on proven signals (after P4) |
| NATS / Redis Streams | in-process event bus | backend splits into several processes |
| CryptoPanic API, FinBERT | — | news sources/classifier choice at P5 |

Reading: *Advances in Financial Machine Learning* (López de Prado) for labelling, purged CV and the
deflated Sharpe ratio. These are the core anti-overfitting ideas behind the M3 gate.
