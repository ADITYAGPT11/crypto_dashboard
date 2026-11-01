# Phase 1 UX: the evidence foundation

**Prototype:** [`phase1-prototype.html`](phase1-prototype.html). Open it in a browser; it is
self-contained and uses sample data. All six screens, symbol/study search (Ctrl/⌘ K), the
explainer drawer, the risk calculator and the condition preview work.

## Design thesis

The product exists to issue **high-confidence trade confirmations** backed by research,
backtesting, forward testing, measured edge, probability, TA, news and risk. Phase 1 can't issue
confirmations yet. It builds the data and statistics they will stand on. So the UI:

1. **Is organised around the confirmation from day one.** The home screen is the
   *Confirmation desk*: the full pipeline (Data → TA → Stats → Backtest → Forward → News → Risk →
   Confirmation), with what each stage does, its status, and the phase that unlocks it. "0
   confirmations" is shown honestly, with the path to the first one.
2. **Speaks in evidence, not opinion.** Every probability carries its sample size (n) and a 95%
   Wilson range. If the range crosses 50% the verdict is **no edge**. Indicator readings are
   ranked against two years of stored history (percentiles).
3. **Explains without dumbing down.** Real terms (base rate, percentile, R, expectancy,
   break-even win rate, regime) each have a "?" that opens a precise definition. The Method
   drawer explains how we avoid fooling ourselves (sample size, ranges, multiple testing).

## Screens and features

| Screen | What it does | Moto pillar | Backend it needs |
| --- | --- | --- | --- |
| **Desk** (home) | Pipeline status across all 8 stages; conditions active right now with probability, n, 95% range, verdict; path to first confirmation; regime per major | Confirmation, statistics | `/pipeline`, `/studies/active`, `/regime` |
| **Market** | Price with EMA 50 + Bollinger; indicator readings as 2-year percentiles; "When conditions looked like this, what happened next?" histogram of forward returns with n, P, range, median, 5th/95th percentile | TA, statistics | `/candles`, `/indicators`, `/studies/{id}/events` |
| **Evidence** | Base-rate study library with verdicts and next step (backtest in P2 or archive); "how a study becomes a confirmation"; guards against overfitting | Research, probability, mathematical edge | `/studies` |
| **Risk** | Position-size calculator from equity, risk %, entry, stop, target, fees and assumed win probability: size, money at risk, R:R, break-even win rate, expectancy, implied leverage; Phase 6 portfolio limits previewed | Risk management | none (pure maths); limits from config |
| **Conditions** | Sentence-style watch ("Notify me when SOL-USDT funding percentile is above 95"), **with its history shown before saving** (times it happened, P(outcome), range, verdict, low-n warning); Telegram delivery | Statistics, alerts | `/conditions` CRUD, `/studies/preview`, Telegram worker |
| **Research data** | Coverage per series, missing minutes, quality checks, backfill queue, feed status | Data (the foundation of backtests) | `/coverage`, `/quality`, `/backfill`, `/health` |

Later phases plug into the same shell: Backtest results (P2) feed the Evidence screen,
forward-test records (P4) and news windows (P5) light up their pipeline stages, and confirmation
cards (P6) take over the top of the Desk (see the earlier canvas for their layout).

## Screen flow

```mermaid
flowchart LR
  D["Desk<br/>pipeline · active conditions"] --> M["Market<br/>TA readings · forward-return study"]
  D --> E["Evidence<br/>base-rate library"]
  M -- "study looks like an edge" --> E
  E -- "edge candidate" --> BT["Backtest (Phase 2)"]
  M --> C["Conditions<br/>watch with history preview"]
  D --> R["Risk<br/>position sizing"]
  D --> DATA["Research data<br/>coverage · quality"]
  D & M & E & R & C -.-> X["Explainer drawer<br/>? · Method"]
```

## Rules for every screen

1. Every probability shows **n** and a **95% range**; never a bare percentage.
2. A range that crosses 50% is labelled **no edge**. Below 30 events, warn "too few to trust".
3. Statistics are labelled **observations**; only the pipeline's last stage may say
   "confirmation".
4. Every number shows freshness or provenance (live age, stored range, study period).
5. Every term of art has a "?" with a precise definition; no hover-only tooltips.
6. Inputs explain their effect live (risk calculator, condition preview).
7. State is shown in words and shape, not colour alone (chips with text, ▲▼, +/−).
8. Locked features are visible, labelled with the phase that unlocks them, never hidden.

## Visual language: research instrument

| Token | Value | Use |
| --- | --- | --- |
| Ground / surface / well | `#07090D` / `#0D1218` / `#0A0E14` | page, cards (solid), chart wells |
| Signal | `#7CC4FF` ice blue | primary action, probability marks, active nav |
| Amber | `#F2B544` | warnings, gaps, EMA line |
| Up / down | `#46D18C` / `#FF6B7A` | always with ▲▼ or +/− |
| UI face | Instrument Sans | labels, text |
| Data face | JetBrains Mono, tabular numbers | every figure |

- **Dense and precise:** 14 px base, 12-column grid, hairline borders, uppercase micro-labels,
  confidence-range bars and percentile ticks as the core visual devices.
- **Glassmorphism only on floating chrome:** side rail (bottom bar on phones), sticky command
  bar, search dialog, explainer drawer, toasts. Evidence cards stay solid for contrast.
- **Parallax only in the Desk header:** contour field, dot grid and a price trace move at three
  depths on scroll and pointer; off under `prefers-reduced-motion`; complete at rest.

## Acceptance criteria (real implementation)

- [ ] All six screens built in `apps/web` against the Phase 1 API.
- [ ] Every probability computed server-side from stored data, with n and Wilson range.
- [ ] Studies are reproducible: stored definition, data range and code version.
- [ ] Every "?" and the Method drawer have final copy.
- [ ] Contrast ≥ 4.5:1 on solid and glass surfaces; parallax off under reduced motion.
- [ ] Works at 400 px with no horizontal page scroll.
- [ ] Conditions fire server-side with the browser closed and arrive on Telegram.
