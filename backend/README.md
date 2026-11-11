# TCS analysis service (Python)

One rule set for pattern detection, demand/supply zones, order blocks and setup statistics.
The chart calls it on recent candles; the background job runs it over one to two years of
history for every research coin. Same code, same parameters: see `src/tcs/analysis/engine.py`.

```bash
uv sync                   # Python 3.12 + locked deps (TA-Lib ships as a wheel)
uv run tcs serve          # API on :8000 + scheduled statistics job (npm run api from the root)
uv run tcs stats 4h       # one statistics run now (1h | 4h | 1d)
uv run tcs backfill       # download history into data/tcs.sqlite3
uv run pytest             # tests; plus ruff format/check and pyright (npm run api:check)
```

Settings (environment, no secrets): `TCS_DB` (SQLite path, default `data/tcs.sqlite3`),
`TCS_STATS_DAYS` (default 730), `TCS_UNIVERSE` (comma list, default the 10 research coins),
`TCS_STATS_SCHEDULE=0` to disable the background job, `TCS_HOST`, `TCS_PORT`.

Data: Binance USDⓈ-M public REST for the recent tail and Binance's public archive
(`data.binance.vision`) for bulk history. Both free, no key. Where REST is geo-blocked the data
ends at the last archived day and every response says how many candles it is behind.

Pattern rules and their sources: `docs/product/patterns.md`. Changing a rule means bumping
`RULESET_VERSION` in `src/tcs/analysis/catalog.py` and regenerating the golden snapshot
(`uv run python -m tests.test_golden`).
