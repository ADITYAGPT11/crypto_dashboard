"""Books → one-minute heatmap columns (a port of the sampling in ``liquidityHeatmap.ts``).

Every few seconds the synced books are bucketed by price (notional in quote currency per
bucket, bids and asks apart, exchanges added up). Samples are averaged per minute, so a stored
column is "resting notional per bucket, averaged over that minute": a wall that sat there all
minute counts fully, one flashed for a second barely shows. The bucket size gives about 120
buckets across the books' reach (same as the browser's) and is kept unless that reach changes by more than 2x.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass, field

from tcs.depth.books import LocalBook

BUCKETS_ACROSS_BOOK = 120
MINUTE_MS = 60_000
_NICE = (1.0, 2.0, 2.5, 5.0, 10.0)


def nice_step(raw: float) -> float:
    """The smallest round step (1, 2, 2.5, 5 x 10^k) at or above ``raw``."""
    if not raw > 0:
        return 1.0
    mag = 10 ** math.floor(math.log10(raw))
    step = next((n for n in _NICE if n * mag >= raw * (1 - 1e-9)), 10.0)
    return float(f"{step * mag:.12g}")


def bucket_for_books(books: Sequence[LocalBook]) -> float | None:
    lo, hi = math.inf, -math.inf
    for b in books:
        if b.bids:
            lo = min(lo, min(b.bids))
        if b.asks:
            hi = max(hi, max(b.asks))
    return nice_step((hi - lo) / BUCKETS_ACROSS_BOOK) if hi > lo else None


def stable_bucket(current: float | None, proposed: float | None) -> float | None:
    if proposed is None:
        return current
    if current is None:
        return proposed
    ratio = proposed / current
    return proposed if ratio > 2 or ratio < 0.5 else current


@dataclass(slots=True)
class Column:
    """Average resting notional per bucket over one minute."""

    time: int  # minute open, ms
    bucket: float
    mid: float
    samples: int
    bids: dict[int, float] = field(default_factory=dict[int, float])
    asks: dict[int, float] = field(default_factory=dict[int, float])


class MinuteSampler:
    def __init__(self) -> None:
        self.bucket: float | None = None
        self._open: Column | None = None
        self._mid_sum = 0.0

    def sample(self, books: Sequence[LocalBook], now_ms: int) -> Column | None:
        """Add one sample of ``books``; returns the previous minute's column once it is over."""
        minute = now_ms // MINUTE_MS * MINUTE_MS
        done = self._close_if_before(minute)
        mids = [m for m in (b.mid() for b in books) if m is not None]
        if not mids:
            return done
        proposed = bucket_for_books(books)
        bucket = stable_bucket(self.bucket, proposed)
        if bucket is None:
            return done
        if self._open is not None and bucket != self._open.bucket:
            done = done or self._finish()  # bucket changed mid-minute: start a fresh column
        self.bucket = bucket
        col = self._open
        if col is None:
            col = self._open = Column(minute, bucket, 0.0, 0)
            self._mid_sum = 0.0
        col.samples += 1
        self._mid_sum += sum(mids) / len(mids)
        for b in books:
            _add(col.bids, b.bids, bucket)
            _add(col.asks, b.asks, bucket)
        return done

    def flush(self) -> Column | None:
        return self._finish()

    def _close_if_before(self, minute: int) -> Column | None:
        if self._open is not None and self._open.time < minute:
            return self._finish()
        return None

    def _finish(self) -> Column | None:
        col, self._open = self._open, None
        if col is None or col.samples == 0:
            return None
        n = col.samples
        col.mid = self._mid_sum / n
        col.bids = {k: v / n for k, v in col.bids.items()}
        col.asks = {k: v / n for k, v in col.asks.items()}
        return col


def _add(into: dict[int, float], side: dict[float, float], bucket: float) -> None:
    for p, q in side.items():
        k = math.floor(p / bucket)
        into[k] = into.get(k, 0.0) + p * q
