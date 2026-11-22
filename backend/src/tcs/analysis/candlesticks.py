"""Candlestick patterns, written in-house to the published definitions.

Why not TA-Lib's ``CDL*`` functions (used until rule set r4): its shooting star,
inverted hammer and morning / evening star demand a gap between candle bodies,
which a 24/7 market never has (each candle opens at the previous close), so they
fired only on one-tick differences; its hammer family accepts a shadow just longer
than the body where Nison asks for twice. See ``docs/product/patterns.md``.

Each rule is written once for the bullish pattern. The bearish twin is the same
rule on the mirrored series (``tcs.common.series.mirror``): upside down, a hammer
is a shooting star, an inverted hammer a hanging man.

Shape (Nison, *Japanese Candlestick Charting Techniques*; StockCharts ChartSchool):

- **Bullish engulfing**: a down candle that is not a doji, then an up candle whose
  body covers its body (one end may be equal).
- **Hammer**: lower shadow at least twice the body, upper shadow at most a tenth of
  the range. **Inverted hammer**: the same upside down within the candle (upper
  shadow at least twice the body, lower shadow at most a tenth). No gap required.
- **Morning star**: a long down candle; a short-bodied star whose body sits wholly
  below the first body (touching allowed: the 24/7 form of the gap); a long up
  candle closing above the middle of the first body ("well into it").
- **Bullish harami**: a long down candle, then a short body inside its body.

"Long" and "short" bodies are measured against the mean body of the ten candles
before (TA-Lib's default candle settings, the common quantification); a doji's
body is at most a tenth of its range.

Context and plan, the same for every pattern:

- **No trend filter** (removed in r6): requiring a prior decline did not improve the
  measured win rate and cut the cases to a third (``docs/context/DECISIONS.md``, 2026-11-22).
- **Size**: the pattern's high-low range is at least ``MIN_RANGE_ATR`` ATR.
- **Confirmation** (Nison; Bulkowski's breakout): within ``CONFIRM_BARS`` candles a
  close above the pattern's high; a close below its low first cancels it. The
  morning star confirms itself (its third candle).
- **Plan**: entry at the confirmation close; stop ``STOP_PAD_ATR`` ATR beyond the
  pattern's extreme; target ``TARGET_R`` times the risk.

Left out: piercing line, dark cloud cover, kicking and abandoned baby (their gaps
are the pattern), three white soldiers / black crows (about once a year), doji
(indecision, not a direction).
"""

from __future__ import annotations

from collections.abc import Callable

import numpy as np

from tcs.analysis.indicators import atr
from tcs.analysis.mirroring import unmirror
from tcs.analysis.types import PatternHit, Point
from tcs.common.series import FloatArray, Series, mirror

AVG_BODY_BARS = 10  # long / short bodies against the mean body of this many candles before
DOJI_BODY = 0.1  # body at most this share of the range
SHADOW_BODY = 2.0  # hammer family: long shadow at least this many bodies
SHORT_SHADOW = 0.1  # hammer family: the other shadow at most this share of the range
STAR_CLOSE_INTO = 0.5  # morning star: third close above this share of the first body
MIN_RANGE_ATR = 0.8
CONFIRM_BARS = 3
STOP_PAD_ATR = 0.1
TARGET_R = 1.5

Shape = Callable[["_Bars", int], bool]


class _Bars:
    """Per-candle measures every shape reads (one pass, plain floats)."""

    def __init__(self, s: Series) -> None:
        self.o, self.h, self.lo, self.c = s.open, s.high, s.low, s.close
        self.top = np.maximum(s.open, s.close)
        self.bottom = np.minimum(s.open, s.close)
        self.body = self.top - self.bottom
        self.range = s.high - s.low
        mean = np.full(len(s), np.nan)
        if len(s) > AVG_BODY_BARS:
            csum = np.concatenate([[0.0], np.cumsum(self.body)])
            idx = np.arange(AVG_BODY_BARS, len(s))
            mean[idx] = (csum[idx] - csum[idx - AVG_BODY_BARS]) / AVG_BODY_BARS
        self.avg_body = mean

    def up(self, i: int) -> bool:
        return bool(self.c[i] > self.o[i])

    def down(self, i: int) -> bool:
        return bool(self.c[i] < self.o[i])

    def long(self, i: int) -> bool:
        return bool(self.body[i] > self.avg_body[i])

    def short(self, i: int) -> bool:
        return bool(self.body[i] <= self.avg_body[i])

    def doji(self, i: int) -> bool:
        return bool(self.body[i] <= DOJI_BODY * self.range[i])


def _engulfing(b: _Bars, i: int) -> bool:
    j = i - 1
    if not (b.down(j) and not b.doji(j) and b.up(i)):
        return False
    covers = b.o[i] <= b.c[j] and b.c[i] >= b.o[j]
    return bool(covers and (b.o[i] < b.c[j] or b.c[i] > b.o[j]))


def _hammer(b: _Bars, i: int) -> bool:
    r = b.range[i]
    lower, upper = b.bottom[i] - b.lo[i], b.h[i] - b.top[i]
    return bool(r > 0 and lower >= SHADOW_BODY * b.body[i] and upper <= SHORT_SHADOW * r)


def _inverted_hammer(b: _Bars, i: int) -> bool:
    r = b.range[i]
    lower, upper = b.bottom[i] - b.lo[i], b.h[i] - b.top[i]
    return bool(r > 0 and upper >= SHADOW_BODY * b.body[i] and lower <= SHORT_SHADOW * r)


def _morning_star(b: _Bars, i: int) -> bool:
    first, star = i - 2, i - 1
    if not (b.down(first) and b.long(first) and b.short(star) and b.up(i) and b.long(i)):
        return False
    below = b.top[star] <= b.bottom[first]  # star body wholly below the first body
    middle = b.c[first] + STAR_CLOSE_INTO * b.body[first]
    return bool(below and b.c[i] > middle)


def _harami(b: _Bars, i: int) -> bool:
    j = i - 1
    if not (b.down(j) and b.long(j) and b.short(i)):
        return False
    inside = b.top[i] <= b.o[j] and b.bottom[i] >= b.c[j]
    return bool(inside and b.body[i] < b.body[j])


#: pattern -> (shape test on its last candle, candles, confirms itself)
RULES: dict[str, tuple[Shape, int, bool]] = {
    "bullishEngulfing": (_engulfing, 2, False),
    "hammer": (_hammer, 1, False),
    "invertedHammer": (_inverted_hammer, 1, False),
    "morningStar": (_morning_star, 3, True),
    "bullishHarami": (_harami, 2, False),
}

BEARISH_TWIN = {
    "bullishEngulfing": "bearishEngulfing",
    "hammer": "shootingStar",
    "invertedHammer": "hangingMan",
    "morningStar": "eveningStar",
    "bullishHarami": "bearishHarami",
}


def _bullish(s: Series, a: FloatArray) -> list[PatternHit]:
    n = len(s)
    b = _Bars(s)
    found: dict[tuple[str, int], PatternHit] = {}
    for end in range(AVG_BODY_BARS + 2, n):
        for pattern, (shape, size, self_confirming) in RULES.items():
            start = end - size + 1
            if not shape(b, end):
                continue
            low = float(s.low[start : end + 1].min())
            high = float(s.high[start : end + 1].max())
            ae = float(a[end])
            if not np.isfinite(ae) or ae <= 0 or high - low < MIN_RANGE_ATR * ae:
                continue
            confirm: int | None = end if self_confirming else None
            if confirm is None:
                for c in range(end + 1, min(end + CONFIRM_BARS, n - 1) + 1):
                    if s.close[c] < low:
                        break
                    if s.close[c] > high:
                        confirm = c
                        break
            if confirm is None:
                continue
            ac = float(a[confirm])
            entry = float(s.close[confirm])
            stop = low - STOP_PAD_ATR * ac
            found[(pattern, confirm)] = PatternHit(
                pattern=pattern,
                direction="long",
                index=confirm,
                entry=entry,
                stop=stop,
                target=entry + TARGET_R * (entry - stop),
                start=start,
                extreme=low,
                points=tuple(Point(i, float(s.low[i])) for i in range(start, end + 1)),
            )
    # A later pattern confirmed on the same candle replaces an earlier one (the latest trigger).
    return list(found.values())


def detect_candlesticks(s: Series, atrs: FloatArray | None = None) -> list[PatternHit]:
    if len(s) < AVG_BODY_BARS + 3:
        return []
    a = atr(s) if atrs is None else atrs
    bearish = [unmirror(h, BEARISH_TWIN[h.pattern]) for h in _bullish(mirror(s), a)]
    return [*_bullish(s, a), *bearish]
