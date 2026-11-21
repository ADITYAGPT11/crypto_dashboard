"""What happened after a setup: target before stop, within a holding limit.

Walk forward from the candle after confirmation. If a candle reaches both the
stop and the target we cannot know which came first, so we count the STOP
(conservative). The holding limit is ``MAX_HOLD_BARS`` candles, or the formation's
own length when that is longer (a 60-candle pattern gets 60 candles to play out).
``expired`` = neither within the limit: the trade is closed at the market (the last
candle's close) and its result counts like any other; ``open`` = the data ran out
first (still running: never counted in statistics).
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
    #: Result in R: (target - entry) / risk on wins, -1 on losses, the market close's R when
    #: expired, 0 while open.
    r: float
    bars: int


def hold_bars(hit: PatternHit) -> int:
    """Candles a setup has to reach its target: at least ``MAX_HOLD_BARS``, or its formation."""
    return max(MAX_HOLD_BARS, hit.index - hit.start)


def evaluate(s: Series, hit: PatternHit, max_bars: int | None = None) -> Outcome:
    long = hit.direction == "long"
    risk = (hit.entry - hit.stop) if long else (hit.stop - hit.entry)
    reward = (hit.target - hit.entry) if long else (hit.entry - hit.target)
    max_bars = hold_bars(hit) if max_bars is None else max_bars
    last = min(hit.index + max_bars, len(s) - 1)
    for j in range(hit.index + 1, last + 1):
        stopped = s.low[j] <= hit.stop if long else s.high[j] >= hit.stop
        if stopped:
            return Outcome("loss", j, -risk / hit.entry * 100, -1.0, j - hit.index)
        reached = s.high[j] >= hit.target if long else s.low[j] <= hit.target
        if reached:
            r = reward / risk if risk > 0 else 0.0
            return Outcome("win", j, reward / hit.entry * 100, r, j - hit.index)
    if hit.index + max_bars > len(s) - 1:
        return Outcome("open", None, 0.0, 0.0, last - hit.index)
    move = (float(s.close[last]) - hit.entry) * (1.0 if long else -1.0)
    r = move / risk if risk > 0 else 0.0
    return Outcome("expired", last, move / hit.entry * 100, r, last - hit.index)


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
