# Open-Source Reuse Audit (Mandatory Pre-Step)

Per `projectNotes.txt` (same folder) "MANDATORY PRE-STEP", this is the documented decision record of what we
reuse vs build, verified against GitHub API data on **2026-10-24**. Re-verify before adopting a
dependency into `package.json`.

Decision vocabulary: **REUSE AS DEPENDENCY** / **ADAPT COMPONENT** / **REFERENCE ONLY** / **REJECT**.

| Project                                                                                       | License                                                 | Activity (as verified)                                      | Decision                                                                                                                                                                                           |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [voidzero-dev/vite-plus](https://github.com/voidzero-dev/vite-plus)                           | bundled w/ npm dist                                     | Maintained; in use at v1.3.0                                | **REUSE AS DEPENDENCY** — already the project toolchain                                                                                                                                            |
| [tradingview/lightweight-charts](https://github.com/tradingview/lightweight-charts)           | Apache-2.0 (LICENSE verified)                           | Actively maintained, official                               | **REUSE AS DEPENDENCY** (Module 4) — comply with TradingView attribution requirements                                                                                                              |
| [ccxt/ccxt](https://github.com/ccxt/ccxt)                                                     | MIT                                                     | Extremely active                                            | **REFERENCE ONLY** (for now) — we use exchange-native WS directly; ccxt REST could be adopted later for instrument metadata; do not assume its WebSocket offerings are free/needed                 |
| [bennycode/trading-signals](https://github.com/bennycode/trading-signals)                     | **No license detected by GitHub API (`license: null`)** | Very active (pushed 2026-10-24, 1,001 stars)                | **REFERENCE ONLY** — no license means no reuse/redistribution rights. Only consider as dependency if a later audit finds a LICENSE file; otherwise write our own indicator math for Module 4       |
| [nazmiefearmutcu/flowmap](https://github.com/nazmiefearmutcu/flowmap)                         | Apache-2.0                                              | Created 2026-06, pushed 2026-10-18, 23 stars, young history | **ADAPT COMPONENT** (candidate, Module 9) — study the TS/React WebGL2 renderer for heatmap reuse; its Python gateway does not fit this project; needs a deeper architecture review before adoption |
| [FIQTOR/cryptopulse](https://github.com/FIQTOR/cryptopulse)                                   | MIT                                                     | Created 2026-10-07, 2 stars, 14 open issues, tiny history   | **REFERENCE ONLY** — layout/data-fallback ideas; too young to adopt                                                                                                                                |
| [AIUngated/crypto-liquidity-terminal](https://github.com/AIUngated/crypto-liquidity-terminal) | MIT                                                     | Stale (pushed 2026-05-27), 5 stars, 0 forks                 | **REFERENCE ONLY** — Next.js 14/Fastify/Prisma stack doesn't match ours anyway                                                                                                                     |

## What this means concretely

- Everything currently in the codebase is built modularly by hand (adapters over exchange-native
  WS, services, normalized types). No third-party dashboard/app was adopted wholesale.
- Planned adoptions: `lightweight-charts` for Module 4 charts (dependency, with attribution note
  in the README/page footer), possibly the FlowMap heatmap _renderer approach_ for Module 9.
- Indicators for Module 4 will likely be implemented in-project due to the trading-signals
  licensing gap; if we write them, keep them pure + unit-tested in `src/utils/`.
