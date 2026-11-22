"""What happened after a setup, managed with the app's trade plan (rule set r8, "plan B").

The plan (``docs/product/patterns.md`` → Trade plan; chosen in the 2026-11-22 trade-plan study
and re-checked with strict 5-minute fills, which moved the trail from 0.5 to 2 ATR):

- **Entry** at the confirmation candle's close (the setup's ``entry``).
- **Stop** at the setup's ``stop`` (``analysis/plan.py`` sets the buffer per timeframe).
- **TP1** at the setup's ``target``: touching it does NOT close the trade; from the close of the
  candle that touched it, the stop trails the best price since entry by ``TRAIL_ATR`` ATRs of
  the pattern timeframe and only ever tightens. Before TP1 the stop does not move.
- **Holding limit**: ``MAX_HOLD_BARS`` pattern candles, or the formation's length when longer;
  then closed at the market (``expired``). Data running out first = ``open`` (never counted).

Results: ``win`` = closed in profit, ``loss`` = closed at or worse than entry, ``expired`` =
closed at the market at the holding limit (counted at its own R, never as a win).

**Strict fills.** The stop is a resting order that moves only at pattern-candle closes, so within
a candle it is one price and its fill does not depend on the order of prices inside the candle.
A stop the market has already passed when it is set (or when a candle opens) fills at that
candle's OPEN, not at the stop price. Given ``fine`` candles (5m) each pattern candle is walked on
them, so a gap inside the candle also fills at the 5-minute open; a pattern candle whose
5-minute candles are not all stored is walked as one candle.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

import numpy as np

from tcs.analysis.indicators import atr
from tcs.analysis.types import PatternHit
from tcs.common.series import FloatArray, Series

MAX_HOLD_BARS = 120
TRAIL_ATR = 2.0  # after TP1, the stop follows the best price by this much ATR
#: Kept for callers that still name the trailing limit separately (same as the holding limit).
TRAIL_MAX_BARS = MAX_HOLD_BARS

Result = Literal["win", "loss", "expired", "open"]


@dataclass(frozen=True, slots=True)
class Outcome:
    result: Result
    exit_index: int | None
    #: Percent move from entry to exit in the trade's favour (negative on losses).
    move_pct: float
    #: Result in R: (exit - entry) / risk in the trade's favour; 0 while open.
    r: float
    bars: int
    exit_price: float | None = None


@dataclass(frozen=True, slots=True)
class Trail:
    """The plan's path: when TP1 was touched and every move of the stop (for drawing)."""

    result: Result
    exit_index: int | None
    exit_price: float | None
    r: float
    bars: int
    #: Pattern candle that first touched TP1 (trailing starts after it).
    activated: int | None
    #: (first pattern candle the stop applies to, stop price), each time the stop moved.
    stops: tuple[tuple[int, float], ...]
    #: True when every candle of the trade was walked on 5-minute candles.
    fine: bool = False


def hold_bars(hit: PatternHit) -> int:
    """Pattern candles a setup may stay open: ``MAX_HOLD_BARS``, or its formation if longer."""
    return max(MAX_HOLD_BARS, hit.index - hit.start)


class _Walk:
    """One trade in "long space" (shorts are walked with prices negated)."""

    def __init__(self, entry: float, stop: float, target: float, k: float) -> None:
        self.entry, self.cur, self.target, self.k = entry, stop, target, k
        self.best = entry
        self.active = False

    def step(self, highs: FloatArray, lows: FloatArray, atr_now: float) -> int | None:
        """Walk consecutive candles; return the index of the one that hit the stop, if any.

        The stop in force during a candle is the one set at the previous candle's close.
        """
        q0 = 0
        n = len(highs)
        if not self.active:
            stop_hits = np.flatnonzero(lows <= self.cur)
            tgt_hits = np.flatnonzero(highs >= self.target)
            s_q = int(stop_hits[0]) if len(stop_hits) else n
            t_q = int(tgt_hits[0]) if len(tgt_hits) else n
            if s_q < n and s_q <= t_q:
                return s_q  # stop first (a candle touching both counts as the stop)
            if t_q == n:
                self.best = max(self.best, float(highs.max()))
                return None
            self.best = max(self.best, float(highs[: t_q + 1].max()))
            self.active = True
            if np.isfinite(atr_now):
                self.cur = max(self.cur, self.best - self.k * atr_now)
            q0 = t_q + 1
        if q0 >= n:
            return None
        h, lo = highs[q0:], lows[q0:]
        run = np.maximum.accumulate(np.maximum(h, self.best))  # best after each close
        trail = run - self.k * atr_now if np.isfinite(atr_now) else np.full_like(run, -np.inf)
        after = np.maximum.accumulate(np.maximum(trail, self.cur))  # stop after each close
        before = np.concatenate(([self.cur], after[:-1]))  # stop in force during each candle
        hit = np.flatnonzero(lo <= before)
        if len(hit):
            q = int(hit[0])
            self.cur = float(before[q])
            return q0 + q
        self.best, self.cur = float(run[-1]), float(after[-1])
        return None


def evaluate_trailing(
    s: Series,
    hit: PatternHit,
    atrs: FloatArray | None = None,
    k: float = TRAIL_ATR,
    max_bars: int | None = None,
    fine: Series | None = None,
    trail_every: Literal["candle", "fine"] = "candle",
) -> Trail:
    """The plan on ``s`` (and on 5-minute ``fine`` candles where they cover a pattern candle).

    ``trail_every="candle"`` (the plan): the trailing stop moves at pattern-candle closes only,
    so within a candle it is a fixed price and the fill does not depend on the order of prices
    inside it; 5-minute candles then only add gap fills (a 5-minute candle opening beyond the
    stop fills at its open). ``"fine"`` moves it at every 5-minute close (measured worse, kept
    for research).
    """
    a = atr(s) if atrs is None else atrs
    d = 1.0 if hit.direction == "long" else -1.0
    risk = (hit.entry - hit.stop) * d
    i = hit.index
    max_bars = hold_bars(hit) if max_bars is None else max_bars
    last = min(i + max_bars, len(s) - 1)
    w = _Walk(d * hit.entry, d * hit.stop, d * hit.target, k)
    stops: list[tuple[int, float]] = [(i + 1, hit.stop)]
    activated: int | None = None
    all_fine = fine is not None

    ms = int(s.open_time[1] - s.open_time[0]) if len(s) > 1 else 0
    f_ms = int(fine.open_time[1] - fine.open_time[0]) if fine is not None and len(fine) > 1 else 0
    per = ms // f_ms if f_ms else 0

    def r_at(price_long: float) -> float:
        return (price_long - w.entry) / risk if risk > 0 else 0.0

    for j in range(i + 1, last + 1):
        before = w.cur
        sub = None
        if fine is not None and per > 1:
            t0 = int(s.open_time[j])
            f0 = int(np.searchsorted(fine.open_time, t0))
            f1 = f0 + per
            if (
                f1 <= len(fine)
                and int(fine.open_time[f0]) == t0
                and int(fine.open_time[f1 - 1]) == t0 + ms - f_ms
            ):
                sub = (f0, f1)
        if sub is not None and fine is not None:
            f0, f1 = sub
            hs = fine.high[f0:f1] if d > 0 else -fine.low[f0:f1]
            ls = fine.low[f0:f1] if d > 0 else -fine.high[f0:f1]
            os_ = d * fine.open[f0:f1]
            # per-candle plan: no move inside the candle (NaN), moved at its close below
            atr_now = float(a[j - 1]) if trail_every == "fine" else float("nan")
        else:
            all_fine = False
            hs = np.array([s.high[j] if d > 0 else -s.low[j]], dtype=np.float64)
            ls = np.array([s.low[j] if d > 0 else -s.high[j]], dtype=np.float64)
            os_ = np.array([d * s.open[j]], dtype=np.float64)
            atr_now = float(a[j])  # updated at this candle's close
        was_active = w.active
        q = w.step(hs, ls, atr_now)
        if w.active and not was_active:
            activated = j
        if q is not None:
            fill = min(w.cur, float(os_[q]))  # opened beyond the stop: filled at the open
            r = r_at(fill)
            return Trail(
                "win" if r > 0 else "loss",
                j,
                d * fill,
                r,
                j - i,
                activated,
                tuple(stops),
                all_fine,
            )
        if sub is not None and trail_every == "candle" and w.active and np.isfinite(a[j]):
            w.cur = max(w.cur, w.best - k * float(a[j]))  # the candle closed: move the stop
        if w.cur != before:
            stops.append((j + 1, d * w.cur))
    if i + max_bars > len(s) - 1:
        return Trail("open", None, None, 0.0, last - i, activated, tuple(stops), all_fine)
    close = float(s.close[last])
    return Trail(
        "expired", last, close, r_at(d * close), last - i, activated, tuple(stops), all_fine
    )


def to_outcome(hit: PatternHit, t: Trail) -> Outcome:
    if t.exit_price is None:
        return Outcome(t.result, t.exit_index, 0.0, 0.0, t.bars, None)
    d = 1.0 if hit.direction == "long" else -1.0
    move_pct = (t.exit_price - hit.entry) * d / hit.entry * 100
    return Outcome(t.result, t.exit_index, move_pct, t.r, t.bars, t.exit_price)


def evaluate(
    s: Series,
    hit: PatternHit,
    max_bars: int | None = None,
    atrs: FloatArray | None = None,
    fine: Series | None = None,
) -> Outcome:
    """The plan's result for one setup (see the module docstring)."""
    return to_outcome(hit, evaluate_trailing(s, hit, atrs, max_bars=max_bars, fine=fine))
