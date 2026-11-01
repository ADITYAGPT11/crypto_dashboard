# M6 · News impact

**Status:** ⬜ Not started.

## Responsibilities

- Ingest crypto news, exchange announcements (listings, delistings, maintenance), the macro
  calendar (CPI, FOMC, NFP) and token unlocks.
- Classify each item by symbols, category and sentiment, and estimate impact.
- **Measure** historical impact (price and volatility move after similar events) before using a
  category as a filter.
- Act as a filter: block or flag signals in high-impact windows; add context to confirmations.

## Flow

```mermaid
flowchart TB
  SRC["RSS / news APIs<br/>exchange announcements<br/>macro calendar"] --> ING["ingest + dedupe"]
  ING --> CLS["classify<br/>symbols · category · sentiment<br/>(LLM or FinBERT)"]
  CLS --> STORE[("M2 news_events")]
  STORE --> STUDY["event study<br/>avg move & vol by category"]
  STUDY --> RULES["impact rules<br/>e.g. block 30 min around FOMC"]
  CAND["M4 candidate"] --> CHECK{"inside a high-impact<br/>window or contrary news?"}
  RULES --> CHECK
  CHECK -- block --> VETO["veto + reason → M5"]
  CHECK -- pass --> RK["M7 risk, with news context"]
```

## Acceptance criteria

- [ ] The event-study table exists for each category before that category may block a signal.
- [ ] Every block reason is visible on the vetoed signal.
- [ ] Forward test (M5) shows whether news filtering improved expectancy, measured rather than assumed.

## Open questions

- Which sources (free tiers vary)? CryptoPanic, exchange RSS/announcement pages, a public
  economic calendar. Decide in Phase 5.
