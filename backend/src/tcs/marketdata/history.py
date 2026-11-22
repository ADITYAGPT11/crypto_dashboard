"""Keep stored history complete: archive for the bulk, REST for the recent tail.

``ensure`` fills, in order:

1. whole past months from the archive (one zip per month);
2. days of the current month from the archive's daily files;
3. the last hours from REST (the archive publishes a day after it closes).

If REST is unreachable (some regions are geo-blocked) the data ends at the last
archived day; callers see that in ``Coverage.last_close`` and say so in the UI.
"""

from __future__ import annotations

import datetime as dt
import logging
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

from tcs.common.series import Candle, Series
from tcs.common.timeframes import TF_MS, Timeframe, last_closed_open
from tcs.marketdata.binance import BinanceKlines, SourceUnavailable
from tcs.store.sqlite import Store

log = logging.getLogger(__name__)
DAY_MS = 86_400_000
ARCHIVE_WORKERS = 4


@dataclass(frozen=True, slots=True)
class Coverage:
    symbol: str
    tf: Timeframe
    first: int | None
    last: int | None
    count: int
    #: Open time of the newest candle that has closed now (what "complete" means).
    expected_last: int
    #: Candles missing inside [first, last] (gaps in the source).
    gaps: int
    rest_ok: bool

    @property
    def behind(self) -> int:
        """Closed candles not stored yet at the end."""
        if self.last is None:
            return -1
        return max(0, (self.expected_last - self.last) // TF_MS[self.tf])


def _month_starts(since: int, until: int) -> list[tuple[int, int]]:
    d = dt.datetime.fromtimestamp(since / 1000, dt.UTC).replace(
        day=1, hour=0, minute=0, second=0, microsecond=0
    )
    end = dt.datetime.fromtimestamp(until / 1000, dt.UTC)
    out: list[tuple[int, int]] = []
    while d <= end:
        out.append((d.year, d.month))
        d = (d + dt.timedelta(days=32)).replace(day=1)
    return out


def _ms(d: dt.datetime) -> int:
    return int(d.timestamp() * 1000)


class History:
    def __init__(self, store: Store, source: BinanceKlines | None = None) -> None:
        self.store = store
        self.source = source or BinanceKlines()

    def coverage(self, symbol: str, tf: Timeframe, now: int) -> Coverage:
        r = self.store.candle_range(symbol, tf)
        expected = last_closed_open(now, tf)
        if r is None:
            return Coverage(symbol, tf, None, None, 0, expected, 0, self.source.rest_available)
        first, last, count = r
        gaps = (last - first) // TF_MS[tf] + 1 - count
        return Coverage(symbol, tf, first, last, count, expected, gaps, self.source.rest_available)

    def ensure(self, symbol: str, tf: Timeframe, since: int, now: int) -> Coverage:
        """Make stored candles cover [since, last closed candle] as far as the sources allow."""
        ms = TF_MS[tf]
        since = (since // ms) * ms
        expected_last = last_closed_open(now, tf)
        r = self.store.candle_range(symbol, tf)
        today = dt.datetime.fromtimestamp(now / 1000, dt.UTC).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        this_month = today.replace(day=1)

        # 1. Whole months before this one, and 2. published days of this month.
        jobs: list[Callable[[], list[Candle] | None]] = []
        have_from, have_to = (r[0], r[1]) if r else (None, None)

        def covered(t0: int, t1: int) -> bool:
            return (
                have_from is not None and have_to is not None and have_from <= t0 and t1 <= have_to
            )

        for year, month in _month_starts(since, _ms(this_month) - 1):
            first = dt.datetime(year, month, 1, tzinfo=dt.UTC)
            m1 = _ms((first + dt.timedelta(days=32)).replace(day=1)) - ms
            if not covered(_ms(first), m1):
                jobs.append(lambda y=year, m=month: self.source.archive_month(symbol, tf, y, m))
        day = max(
            this_month,
            dt.datetime.fromtimestamp(since / 1000, dt.UTC).replace(
                hour=0, minute=0, second=0, microsecond=0
            ),
        )
        while day < today:
            if not covered(_ms(day), _ms(day) + DAY_MS - ms):
                label = day.strftime("%Y-%m-%d")
                jobs.append(lambda d=label: self.source.archive_day(symbol, tf, d))
            day += dt.timedelta(days=1)
        with ThreadPoolExecutor(max_workers=ARCHIVE_WORKERS) as pool:
            for rows in pool.map(self._fetch, jobs):
                if rows:
                    self.store.put_candles(symbol, tf, rows)

        # 3. The tail from REST.
        r = self.store.candle_range(symbol, tf)
        start = since if r is None else r[1] + ms
        if start <= expected_last:
            try:
                self.store.put_candles(
                    symbol, tf, self.source.rest(symbol, tf, start, expected_last)
                )
            except SourceUnavailable as err:
                log.info("REST tail for %s %s unavailable: %s", symbol, tf, err)
        return self.coverage(symbol, tf, now)

    @staticmethod
    def _fetch(fetch: Callable[[], list[Candle] | None]) -> list[Candle] | None:
        try:
            return fetch()
        except SourceUnavailable as err:
            log.info("archive file unavailable: %s", err)
            return None

    def load(self, symbol: str, tf: Timeframe, since: int, now: int) -> Series:
        """Closed candles from ``since`` (never the forming candle)."""
        return self.store.series(symbol, tf, since=since, until=last_closed_open(now, tf))
