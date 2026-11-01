# CLAUDE.md: start here

> **Mission:** an intelligent, research-driven trading system that issues **high-confidence trade
> confirmations** backed by deep research, historical backtesting, forward testing, mathematical
> edge, statistical probability, technical analysis, news impact and risk management.
>
> **Today it is:** a browser React dashboard (live prices/funding from Binance, OKX, Delta India;
> charts + indicators; order book; spread panel; rule-based alerts) plus an unfinished TypeScript
> backend prototype. **It is currently broken**: read `docs/context/STATUS.md` first.

## Context map: read in this order, only as deep as the task needs

| File | Read it when | Keep it updated when |
| --- | --- | --- |
| `docs/context/STATUS.md` | always, first | anything ships, breaks, or is found broken |
| `docs/context/PROJECT_MAP.md` | touching code | files/modules/events are added, moved or removed |
| `docs/context/ARCHITECTURE.md` | adding a service, folder or package | the target structure or chosen stack changes |
| `docs/context/ROADMAP.md` | planning new work | a phase starts, finishes or changes scope |
| `docs/context/DECISIONS.md` | "why is it like this?" | a non-obvious choice is made (append, never rewrite) |
| `docs/context/MINDMAP.md` | onboarding / big picture | modules or roadmap phases change |
| `docs/product/README.md` | product questions, principles | product principles or module list change |
| `docs/product/modules/M*.md` | working on that module (load only the one you need) | its scope, status or acceptance criteria change |
| `docs/product/ux/PHASE1_UX.md` | building any UI screen | features, screens or visual rules change |
| `docs/context/TOOLING.md` | adding a dependency, skill or MCP | a tool is adopted, rejected or dropped |

Prefer these files over re-reading the whole repo. If a file disagrees with the code, the code
wins: fix the file in the same change.

## Commands (Vite+ `vp` is the toolchain, not plain Vite)

```bash
npm ci              # install (Node 22.5+, needed for node:sqlite in the backend prototype)
npm run dev         # dev server on http://localhost:3000
npx vp test         # Vitest unit tests
npx vp check        # format + lint + typecheck (no fixes); `npx vp check --fix` to fix
npm run build       # tsc -b + production build
npm run backend     # backend prototype on :3001 (currently fails to start, see STATUS)
```

**Done means:** `vp check` clean, `vp test` green, `npm run build` passes, and STATUS updated.

## Guardrails (non-negotiable)

1. **No trade execution** or order placement. The system confirms; a human trades.
2. **Free-first:** public exchange APIs only; no paid services, market-data API keys or
   execution endpoints without explicit owner approval. Respect exchange terms and rate limits.
3. **Honest numbers:** never claim to predict price or guarantee an edge. Every confidence figure
   must be measured (backtest + forward test) and shown with its uncertainty. Label observations
   vs estimates; visible orders can be spoofed and owners can't be identified.
4. **Secrets stay server-side** and out of git (Telegram tokens etc.).
5. **Reuse before building:** before adding a dependency or copying code, check licence,
   maintenance and security, and record the decision in `docs/context/TOOLING.md` → Reuse audit.
   No licence means reference only.

## Conventions (follow the existing code)

- **Canonical symbol** outside adapters is `BASE-QUOTE` (e.g. `BTC-USDT`); adapters convert at
  the boundary and never leak exchange-native fields.
- **Market type** `"SPOT" | "FUT"`; **exchange id** `"BINANCE" | "OKX" | "DELTA"`.
- **Funding rate** in *percent*, times in **ms**, intervals in **seconds**.
- All sockets go through `BaseWebSocketClient`; adapters re-send subscriptions on every `open`,
  and one exchange failing must never block the others.
- New shared data flow = singleton service (`getInstance()`/`resetInstance()`) with
  `subscribe()` returning an unsubscribe fn + a small hook in `custom-hooks/`
  (pattern: `useLivePrice.ts`). Don't push tick data through parent React state.
- New pure logic goes in `src/utils/<name>.ts` with tests in `src/utils/__tests__/`.
- New components: folder + `index.ts` + `Component.module.scss`. Don't copy the global-`.scss`
  pattern in `components/dashboard/*`.
- TypeScript strict; no `any`; `import type` for types. No `console.*` in UI components.
- Small, modular changes; don't rewrite working modules without a clear reason.

## Context hygiene (how we keep this fast)

1. Context files are **maps, not copies**: point to `file:line`, don't paste code.
2. Delete stale lines instead of adding "update:" notes. Dead context is worse than none.
3. Every PR that changes behaviour updates `STATUS.md` (and `PROJECT_MAP.md` if structure moved).
4. Unscheduled ideas go in `ROADMAP.md → Parking lot`, not in code comments.
5. One context system only: this file + `docs/`. Don't create parallel agent docs.
