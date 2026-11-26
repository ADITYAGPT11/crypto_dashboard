"""Liquidity sweeps (swing failure patterns): a wick through a swing, a close back inside (r13).

The smart-money / ICT reading: stops rest beyond an obvious swing low; price trades through
them and closes back above, so the break failed. No textbook statistic exists for it (it is
not in Bulkowski or Edwards & Magee), so like every pattern here it is an observation.

Bullish rule (the bearish twin is the same rule on the mirrored series):

- a confirmed swing low (``swings.py``, known ``SWING_BARS`` candles later) that is also the
  lowest low of the ``MAJOR_BARS`` candles before it (an obvious low, where stops gather),
  ``MIN_AGE`` to ``MAX_AGE`` candles old and still intact: no low below it since it formed;
- one candle trades at least ``MIN_DEPTH_ATR`` ATR below it and closes back above it. That
  candle's close confirms it. When it sweeps several swings, the lowest one it closes back
  above is named.

Plan (internal, not shown): entry = the sweep's close; stop = its low - ``STOP_PAD_ATR`` ATR;
target ``TARGET_R`` times the risk.
"""

from __future__ import annotations

import numpy as np

from tcs.analysis.indicators import atr
from tcs.analysis.mirroring import unmirror
from tcs.analysis.swings import SWING_BARS, Swing, swing_lows
from tcs.analysis.types import Line, PatternHit, Point
from tcs.common.series import FloatArray, Series, mirror

MIN_AGE, MAX_AGE = 5, 60  # candles from the swing to the sweep
MIN_DEPTH_ATR = 0.1  # the wick goes at least this far through the swing
MAJOR_BARS = 20  # the swing is the lowest low of this many candles before it
STOP_PAD_ATR = 0.2
TARGET_R = 1.5

BEARISH_TWIN = {"bullishSweep": "bearishSweep"}


def _bullish(s: Series, a: FloatArray) -> list[PatternHit]:
    lows = [
        w
        for w in swing_lows(s, SWING_BARS)
        if w.index >= MAJOR_BARS and w.price < float(s.low[w.index - MAJOR_BARS : w.index].min())
    ]
    hits: list[PatternHit] = []
    active: list[Swing] = []  # known, intact swing lows
    nxt = 0
    for i in range(len(s)):
        while nxt < len(lows) and lows[nxt].known_at <= i:
            active.append(lows[nxt])
            nxt += 1
        low, close, ai = float(s.low[i]), float(s.close[i]), float(a[i])
        swept = [w for w in active if low < w.price]
        if not swept:
            continue
        active = [w for w in active if w not in swept and i - w.index <= MAX_AGE]
        if not (np.isfinite(ai) and ai > 0):
            continue
        valid = [
            w
            for w in swept
            if MIN_AGE <= i - w.index <= MAX_AGE
            and close > w.price
            and w.price - low >= MIN_DEPTH_ATR * ai
        ]
        if not valid:
            continue
        w = min(valid, key=lambda v: v.price)
        stop = low - STOP_PAD_ATR * ai
        hits.append(
            PatternHit(
                pattern="bullishSweep",
                direction="long",
                index=i,
                entry=close,
                stop=stop,
                target=close + TARGET_R * (close - stop),
                start=w.index,
                extreme=low,
                points=(Point(w.index, w.price, "Swing low"), Point(i, low, "Sweep")),
                lines=(Line(Point(w.index, w.price), Point(i, w.price), "Swept level"),),
            )
        )
    return hits


def detect_sweeps(s: Series, atrs: FloatArray | None = None) -> list[PatternHit]:
    a = atr(s) if atrs is None else atrs
    bearish = [unmirror(h, BEARISH_TWIN[h.pattern]) for h in _bullish(mirror(s), a)]
    return [*_bullish(s, a), *bearish]
