# Roadmap — from live dashboard to trade confirmations

Each phase ends with something **measurable**. A confirmation is only "high-confidence" if the
edge behind it has been shown in backtest **and** forward test, with costs included.

## Phase 0 — Live market data layer ✅ (current)
Live prices + funding from Binance, OKX, Delta. See `STATUS.md` for open issues.
**Exit:** known issues 1–5 in `STATUS.md` fixed; data quality is trustworthy.

## Phase 1 — Persistence & history
- Backend service (Node/TS to share types) that holds exchange connections 24/7 — a browser tab
  can't be the source of truth for research.
- Store candles (OHLCV), trades sample, funding history, open interest in a time-series store
  (start simple: SQLite/DuckDB/Parquet; Postgres+Timescale later if needed).
- Historical backfill from exchange REST APIs.
**Exit:** N months of clean, gap-checked history for the target universe.

## Phase 2 — Research & backtesting engine
- Indicator / feature library (TA, funding, basis, volatility, volume).
- Event-driven backtester with fees, slippage, funding costs, latency assumptions.
- Statistics: expectancy, win rate, profit factor, Sharpe/Sortino, max drawdown,
  out-of-sample + walk-forward validation, guard against overfitting (multiple-testing awareness).
**Exit:** a strategy report format that every candidate edge must pass.

## Phase 3 — Signal engine
- Strategies emit candidate signals with entry, stop, target, size and a confidence score.
- Candidates: funding-rate carry, cross-exchange basis/spread (brings back the arbitrage view),
  trend/mean-reversion setups.
**Exit:** live signals shown in the UI, each linked to its backtest evidence.

## Phase 4 — Forward testing (paper trading)
- Record every live signal and its outcome; compare to backtest expectation.
**Exit:** live stats within the backtest's confidence band over a defined sample size.

## Phase 5 — News & context
- News/sentiment ingestion, economic calendar, exchange announcements; tag events and measure
  their historical price impact before using them as a filter.

## Phase 6 — Risk management & confirmation
- Position sizing (fixed-fractional / capped Kelly), portfolio exposure & correlation limits,
  daily loss limits, kill switch.
- **Trade confirmation** = signal + passing evidence + risk check + news check → one card
  with the reasoning attached.

## Parking lot (ideas, not scheduled)
- Order-book depth (removed from Binance stream until there's a consumer).
- Angel One / Indian equities integration (removed in `4350c71`).
- Alerts (Telegram/push) for confirmations.
