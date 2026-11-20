"""What happened after a setup: target before stop, within a holding limit.

Walk forward from the candle after confirmation. If a candle reaches both the
stop and the target we cannot know which came first, so we count the STOP
(conservative). ``expired`` = neither within ``MAX_HOLD_BARS``; ``open`` = the
data ran out first (still running: never counted in statistics).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

import numpy as np

from tcs.analysis.types import PatternHit
from tcs.common.series import FloatArray, Series

MAX_HOLD_BARS = 30

Result = Literal["win", "loss", "expired", "open"]


@dataclass(frozen=True, slots=True)
class Outcome:
    result: Result
    exit_index: int | None
    #: Percent move from entry to exit in the trade's favour (negative on losses).
    move_pct: float
    #: Reward in R on wins ((target - entry) / risk), -1 on losses, 0 otherwise.
    r: float
    bars: int


def evaluate(s: Series, hit: PatternHit, max_bars: int = MAX_HOLD_BARS) -> Outcome:
    long = hit.direction == "long"
    risk = (hit.entry - hit.stop) if long else (hit.stop - hit.entry)
    reward = (hit.target - hit.entry) if long else (hit.entry - hit.target)
    last = min(hit.index + max_bars, len(s) - 1)
    for j in range(hit.index + 1, last + 1):
        stopped = s.low[j] <= hit.stop if long else s.high[j] >= hit.stop
        if stopped:
            return Outcome("loss", j, -risk / hit.entry * 100, -1.0, j - hit.index)
        reached = s.high[j] >= hit.target if long else s.low[j] <= hit.target
        if reached:
            r = reward / risk if risk > 0 else 0.0
            return Outcome("win", j, reward / hit.entry * 100, r, j - hit.index)
    ran_out = hit.index + max_bars > len(s) - 1
    return Outcome("open" if ran_out else "expired", None, 0.0, 0.0, last - hit.index)


# Trailing take-profit (the exit that measured best: docs/product/patterns.md → Exits).
TRAIL_ATR = 0.5  # once the target is touched, the stop follows the best price by this much ATR
TRAIL_MAX_BARS = 120  # closed at the market after this many candles


@dataclass(frozen=True, slots=True)
class Trail:
    """The same setup managed with a trailing take-profit instead of a fixed target.

    Until the target is touched the original stop stands. From the close of the candle that
    touched it, the stop trails the best price since entry by ``TRAIL_ATR`` ATRs (it only ever
    tightens). Each move uses closed candles only; a candle touching the stop exits there first.
    ``win`` = closed above entry (below for shorts), ``loss`` = at or worse than entry,
    ``expired`` = closed at the market after ``TRAIL_MAX_BARS``, ``open`` = still running.
    """

    result: Result
    exit_index: int | None
    exit_price: float | None
    #: Result in R ((exit - entry) / risk in the trade's favour); 0 while open.
    r: float
    bars: int
    #: Candle that first touched the target (trailing starts after its close).
    activated: int | None
    #: (first candle the stop applies to, stop price), each time the stop moves.
    stops: tuple[tuple[int, float], ...]


def evaluate_trailing(
    s: Series,
    hit: PatternHit,
    atrs: FloatArray,
    k: float = TRAIL_ATR,
    max_bars: int = TRAIL_MAX_BARS,
) -> Trail:
    d = 1.0 if hit.direction == "long" else -1.0
    risk = (hit.entry - hit.stop) * d
    i = hit.index
    last = min(i + max_bars, len(s) - 1)
    cur = hit.stop
    best = hit.entry
    activated: int | None = None
    stops: list[tuple[int, float]] = [(i + 1, cur)]

    def r_at(price: float) -> float:
        return (price - hit.entry) * d / risk if risk > 0 else 0.0

    for j in range(i + 1, last + 1):
        hi, lo = float(s.high[j]), float(s.low[j])
        if (lo <= cur) if d > 0 else (hi >= cur):
            r = r_at(cur)
            return Trail("win" if r > 0 else "loss", j, cur, r, j - i, activated, tuple(stops))
        best = max(best, hi) if d > 0 else min(best, lo)
        if activated is None and ((hi >= hit.target) if d > 0 else (lo <= hit.target)):
            activated = j
        a = float(atrs[j])
        if activated is not None and np.isfinite(a):
            new = best - d * k * a
            if (new - cur) * d > 0:
                cur = new
                stops.append((j + 1, cur))
    if i + max_bars > len(s) - 1:
        return Trail("open", None, None, 0.0, last - i, activated, tuple(stops))
    close = float(s.close[last])
    return Trail("expired", last, close, r_at(close), last - i, activated, tuple(stops))


# After-the-pattern ride: what price did next, without a target (docs/product/patterns.md → Ride).
RIDE_ATR = 10  # Supertrend (10, 3): TradingView's default, not tuned (tuning did not hold up)
RIDE_MULT = 3.0
RIDE_MAX_BARS = 200


@dataclass(frozen=True, slots=True)
class Ride:
    """The move after a setup, ridden with a Supertrend (10, 3) that starts at the entry.

    The band starts at the entry candle's hl2 - 3 x ATR(10) (+ for shorts) and only moves in the
    trade's favour; the ride ends on the first close beyond the previous candle's band (the
    Supertrend flip), at that close, or at the market after ``RIDE_MAX_BARS`` candles.
    ``open`` = the data ran out first (not counted). Moves are percent in the trade's favour.
    """

    result: Literal["closed", "open"]
    exit_index: int | None
    exit_price: float | None
    move_pct: float
    #: Best and worst price during the ride, percent from entry in the trade's favour.
    best_pct: float
    worst_pct: float
    bars: int
    #: (first candle the band applies to, band price), each time it moves.
    band: tuple[tuple[int, float], ...]


def evaluate_ride(
    s: Series,
    index: int,
    direction: str,
    atrs: FloatArray,
    m: float = RIDE_MULT,
    max_bars: int = RIDE_MAX_BARS,
) -> Ride:
    d = 1.0 if direction == "long" else -1.0
    e = float(s.close[index])
    a0 = float(atrs[index])
    if not (np.isfinite(a0) and e > 0):
        return Ride("open", None, None, 0.0, 0.0, 0.0, 0, ())
    band = (float(s.high[index]) + float(s.low[index])) / 2 - d * m * a0
    bands: list[tuple[int, float]] = [(index + 1, band)]
    best = worst = 0.0
    last = min(index + max_bars, len(s) - 1)

    def pct(price: float) -> float:
        return (price - e) * d / e * 100

    for j in range(index + 1, last + 1):
        hi, lo, close = float(s.high[j]), float(s.low[j]), float(s.close[j])
        best = max(best, pct(hi if d > 0 else lo))
        worst = min(worst, pct(lo if d > 0 else hi))
        if (close < band) if d > 0 else (close > band):
            return Ride("closed", j, close, pct(close), best, worst, j - index, tuple(bands))
        a = float(atrs[j])
        if np.isfinite(a):
            new = (hi + lo) / 2 - d * m * a
            if (new - band) * d > 0:
                band = new
                bands.append((j + 1, band))
    close = float(s.close[last])
    if index + max_bars > len(s) - 1:
        return Ride("open", None, None, pct(close), best, worst, last - index, tuple(bands))
    return Ride("closed", last, close, pct(close), best, worst, last - index, tuple(bands))


def ride_baseline(s: Series, direction: str, atrs: FloatArray, samples: int = 2000) -> list[Ride]:
    """The same ride from evenly spaced candles (about ``samples``), as a random-entry control."""
    start = 4 * RIDE_ATR
    step = max(1, (len(s) - start) // samples)
    return [
        r
        for i in range(start, len(s), step)
        if (r := evaluate_ride(s, i, direction, atrs)).result == "closed"
    ]
