# M2 · Data store & history

**Status:** ⬜ Not started. Nothing is persisted today.

## Responsibilities
- Persist candles (1m base, higher timeframes derived), funding history, open interest, sampled
  trades, news events, signals and paper trades.
- Backfill history from exchange REST APIs; detect and repair gaps.
- Serve fast range queries to research (M3) and live lookbacks to the signal engine (M4).

## Flow

```mermaid
flowchart TB
  LIVE["M1 live events"] --> W["writer<br/>batch every 1–5 s"]
  REST["exchange REST"] --> BFJ["backfill job<br/>per symbol × range"]
  BFJ --> W
  W --> RAW[("raw tables<br/>candles_1m · funding · oi")]
  RAW --> QC{"quality check<br/>gaps · dupes · outliers"}
  QC -- issue --> BFJ
  QC -- ok --> AGG["derive 5m/15m/1h/4h/1d"]
  AGG --> RAW
  RAW --> M3["M3 research"]
  RAW --> M4["M4 lookback"]
```

## Storage choice (proposed)
Start with **DuckDB + Parquet**: embedded, zero ops, very fast for analytical scans, and readable
from Python and Node. Move to **TimescaleDB** or **QuestDB** only if concurrent writers or remote
access require it. Recorded in `docs/context/DECISIONS.md` once agreed.

## Core tables
| Table | Key | Columns |
| --- | --- | --- |
| `candles` | exchange, symbol, market, interval, ts_open | o, h, l, c, v, trades |
| `funding` | exchange, symbol, ts | rate_pct, interval_s |
| `open_interest` | exchange, symbol, ts | oi, oi_usd |
| `news_events` | id | ts, source, title, symbols[], category, impact_score |
| `signals` | id | ts, strategy, symbol, side, entry, stop, target, score, status |
| `paper_trades` | id | signal_id, open_ts, close_ts, entry, exit, pnl_r, fees, reason |

## Acceptance criteria
- [ ] 2+ years of 1m candles for the top 20 USDT pairs (Binance and OKX), with funding history.
- [ ] Gap report shows < 0.1 % missing minutes after backfill.
- [ ] A 1-year 1m scan for one symbol returns in under 1 s.
