"""Deep candle history from Binance USDⓈ-M futures public REST (no key).

Paged backwards (1,500 candles per request), closed candles only, cached per
symbol x interval until a newer candle closes. QuestDB replaces the cache later
in Phase 1b; callers only see `HistorySource.load`.
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Awaitable, Callable
from typing import Protocol

import httpx

from tcs.common.symbols import INTERVAL_MS, next_close, to_binance, validate_interval
from tcs.marketdata.candles import Candles

BINANCE_KLINES_URL = "https://fapi.binance.com/fapi/v1/klines"
PAGE_LIMIT = 1500  # Binance futures maximum per request (weight 10)
DEFAULT_PAGES = 2  # ≈ 3,000 candles: ~500 days of 4h, same depth as the browser
MAX_CONCURRENT_REQUESTS = 4  # stay far below the 2,400 weight/minute limit

Fetcher = Callable[[str, dict[str, str | int]], Awaitable[object]]
Clock = Callable[[], int]


class HistorySource(Protocol):
    async def load(self, symbol: str, interval: str) -> Candles: ...


def _now_ms() -> int:
    return int(time.time() * 1000)


def parse_klines(raw: object) -> list[tuple[int, float, float, float, float, float]]:
    """Binance kline rows -> (open_time, o, h, l, c, v). Malformed rows are skipped."""
    if not isinstance(raw, list):
        return []
    out: list[tuple[int, float, float, float, float, float]] = []
    for row in raw:
        if not isinstance(row, list) or len(row) < 6:
            continue
        try:
            out.append(
                (
                    int(row[0]),
                    float(row[1]),
                    float(row[2]),
                    float(row[3]),
                    float(row[4]),
                    float(row[5]),
                )
            )
        except (TypeError, ValueError):
            continue
    return out


class BinanceHistory:
    """`HistorySource` backed by Binance REST with an in-memory, close-aware cache."""

    def __init__(
        self,
        fetcher: Fetcher | None = None,
        clock: Clock = _now_ms,
        pages: int = DEFAULT_PAGES,
    ) -> None:
        self._fetcher = fetcher
        self._client: httpx.AsyncClient | None = None
        self._clock = clock
        self._pages = pages
        self._cache: dict[tuple[str, str], tuple[int, Candles]] = {}
        self._locks: dict[tuple[str, str], asyncio.Lock] = {}
        self._sem = asyncio.Semaphore(MAX_CONCURRENT_REQUESTS)

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    async def _get(self, url: str, params: dict[str, str | int]) -> object:
        if self._fetcher is not None:
            return await self._fetcher(url, params)
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=15.0)
        async with self._sem:
            res = await self._client.get(url, params=params)
        res.raise_for_status()
        return res.json()

    async def load(self, symbol: str, interval: str) -> Candles:
        validate_interval(interval)
        key = (symbol, interval)
        lock = self._locks.setdefault(key, asyncio.Lock())
        async with lock:
            hit = self._cache.get(key)
            if hit is not None and next_close(hit[0], interval) > self._clock():
                return hit[1]
            candles = await self._fetch(symbol, interval)
            self._cache[key] = (self._clock(), candles)
            return candles

    async def _fetch(self, symbol: str, interval: str) -> Candles:
        rows: list[tuple[int, float, float, float, float, float]] = []
        end_time: int | None = None
        for _ in range(self._pages):
            params: dict[str, str | int] = {
                "symbol": to_binance(symbol),
                "interval": interval,
                "limit": PAGE_LIMIT,
            }
            if end_time is not None:
                params["endTime"] = end_time
            batch = parse_klines(await self._get(BINANCE_KLINES_URL, params))
            if not batch:
                break
            rows.extend(batch)
            if len(batch) < PAGE_LIMIT:
                break
            end_time = min(r[0] for r in batch) - 1
        cutoff = self._clock()
        step = INTERVAL_MS[interval]
        closed = [r for r in rows if r[0] + step <= cutoff]
        return Candles.from_rows(symbol, interval, closed)
