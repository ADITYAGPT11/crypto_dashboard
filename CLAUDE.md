# CLAUDE.md — start here

> **Mission:** an intelligent, research-driven trading system that issues **high-confidence trade
> confirmations** backed by deep research, historical backtesting, forward testing, mathematical
> edge, statistical probability, technical analysis, news impact and risk management.
>
> **Today it is:** a browser-only React dashboard that streams live spot/futures prices and funding
> rates from Binance, OKX and Delta Exchange (India). It is the *data layer* of that system — see
> `docs/context/ROADMAP.md` for the path from here to confirmations.

## Context map — read in this order, only as deep as the task needs

| File | Read it when | Keep it updated when |
| --- | --- | --- |
| `docs/context/STATUS.md` | always, first | anything ships, breaks, or is found broken |
| `docs/context/PROJECT_MAP.md` | touching code | files/modules/events are added, moved or removed |
| `docs/context/ARCHITECTURE.md` | adding a service, folder or package | the target structure or chosen stack changes |
| `docs/context/ROADMAP.md` | planning new work | a phase starts, finishes or changes scope |
| `docs/context/DECISIONS.md` | "why is it like this?" | a non-obvious choice is made (append, never rewrite) |
| `docs/context/MINDMAP.md` | onboarding / big picture | modules or roadmap phases change |
| `docs/product/README.md` | product questions, architecture | product principles or module list change |
| `docs/product/modules/M*.md` | working on that module (load only the one you need) | its scope, status or acceptance criteria change |
| `docs/context/TOOLING.md` | choosing a library/skill/MCP | a tool is adopted or dropped |

Prefer these files over re-reading the whole repo. If a file disagrees with the code, the code wins —
fix the file in the same change.

## Commands

```bash
npm ci            # install (Node 22+)
npm run dev       # dev server on http://localhost:3000
npm run build     # tsc -b + production build — must pass before commit
npm run lint      # oxlint via vite-plus (type-aware) — must pass before commit
npx vp fmt src    # format (oxfmt via vite-plus)
```

There is no test runner yet (see STATUS → gaps).

## Conventions (follow the existing code)

- **Canonical symbol** everywhere outside an adapter is `BASE-QUOTE`, e.g. `BTC-USDT`.
  Each adapter converts to/from its exchange format at the boundary.
- **Market type** is `"SPOT" | "FUT"`; **exchange id** is `"BINANCE" | "OKX" | "DELTA"`.
- **Funding rate** is emitted as a *percent* (`0.01` = 0.01 %), next funding time in **ms**,
  interval in **seconds**.
- Adapters extend `eventemitter3` and emit `marketData`, `fundingRate`, `connectionStatus`;
  they re-send all tracked subscriptions on every socket `open` (self-healing reconnect).
- Services are singletons (`getInstance()`). Per-cell UI updates go through
  `LiveMarketDataService` + `useLivePrice`/`useLiveFundingRate`, not React state in a parent.
- New components: folder + `index.ts` + `Component.module.scss` (CSS modules). Older
  `components/dashboard/*` use global `.scss` — don't copy that pattern.
- TypeScript strict; no `any` (lint error). Use `import type` for types.

## Context hygiene (how we keep this fast)

1. Context files are **maps, not copies** — point to `file:line`, don't paste code.
2. Delete stale lines instead of adding "update:" notes. Dead context is worse than none.
3. Every PR that changes behaviour updates `STATUS.md` (and `PROJECT_MAP.md` if structure moved).
4. Ideas/research that aren't scheduled go in `ROADMAP.md → Parking lot`, not in code comments.
