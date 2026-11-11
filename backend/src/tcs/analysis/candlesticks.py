"""Candlestick patterns: TA-Lib decides the SHAPE, these rules add context and a plan.

TA-Lib is the reference implementation of Nison's definitions. It reports a
pattern on its LAST candle (the moment it is complete), using only that candle
and the averages of the candles before it, so there is no look-ahead.

What TA-Lib leaves out and we add (one rule each, same for every pattern):

- **Trend context** (Nison: a reversal pattern needs a trend to reverse). The
  close before the pattern must be below (bullish) / above (bearish) the close
  ``TREND_BARS`` candles earlier.
- **Size**: the pattern's high-low range must be at least ``MIN_RANGE_ATR`` ATR,
  so near-flat "dust" candles do not count.
- **Plan**: entry at the confirmation close; stop ``STOP_PAD_ATR`` ATR beyond the
  pattern's extreme; target ``TARGET_R`` times the risk.

Not used, because they need session gaps a 24/7 market almost never has (checked
on a year of BTC 1h data: zero hits): piercing line, dark cloud cover, kicking,
abandoned baby. Three white soldiers / black crows fire about once a year.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

import numpy as np
import numpy.typing as npt
import talib

from tcs.analysis.indicators import atr
from tcs.analysis.types import Direction, PatternHit, Point
from tcs.common.series import FloatArray, Series

TREND_BARS = 5
MIN_RANGE_ATR = 0.8
STOP_PAD_ATR = 0.1
TARGET_R = 1.5

TaFn = Callable[[FloatArray, FloatArray, FloatArray, FloatArray], npt.NDArray[np.int32]]


@dataclass(frozen=True, slots=True)
class CandleRule:
    fn: str
    size: int
    bullish: str | None
    bearish: str | None


RULES: tuple[CandleRule, ...] = (
    CandleRule("CDLENGULFING", 2, "bullishEngulfing", "bearishEngulfing"),
    CandleRule("CDLHAMMER", 1, "hammer", None),
    CandleRule("CDLHANGINGMAN", 1, None, "hangingMan"),
    CandleRule("CDLINVERTEDHAMMER", 1, "invertedHammer", None),
    CandleRule("CDLSHOOTINGSTAR", 1, None, "shootingStar"),
    CandleRule("CDLMORNINGSTAR", 3, "morningStar", None),
    CandleRule("CDLEVENINGSTAR", 3, None, "eveningStar"),
    CandleRule("CDLHARAMI", 2, "bullishHarami", "bearishHarami"),
)


def _ta(name: str) -> TaFn:
    fn: TaFn = getattr(talib, name)
    return fn


def _trend_ok(s: Series, start: int, direction: Direction) -> bool:
    before = start - 1
    if before - TREND_BARS < 0:
        return False
    prior = s.close[before - TREND_BARS]
    return bool(s.close[before] < prior) if direction == "long" else bool(s.close[before] > prior)


def detect_candlesticks(s: Series, atrs: FloatArray | None = None) -> list[PatternHit]:
    if len(s) < 15:
        return []
    a = atr(s) if atrs is None else atrs
    hits: list[PatternHit] = []
    for rule in RULES:
        out = _ta(rule.fn)(s.open, s.high, s.low, s.close)
        for end in np.flatnonzero(out).tolist():
            sign = int(out[end])
            pattern = rule.bullish if sign > 0 else rule.bearish
            if pattern is None:
                continue
            direction: Direction = "long" if sign > 0 else "short"
            start = end - rule.size + 1
            ae = float(a[end])
            if not np.isfinite(ae) or ae <= 0 or start < 1:
                continue
            low = float(s.low[start : end + 1].min())
            high = float(s.high[start : end + 1].max())
            if high - low < MIN_RANGE_ATR * ae or not _trend_ok(s, start, direction):
                continue
            entry = float(s.close[end])
            if direction == "long":
                stop = low - STOP_PAD_ATR * ae
                target = entry + TARGET_R * (entry - stop)
                extreme = low
            else:
                stop = high + STOP_PAD_ATR * ae
                target = entry - TARGET_R * (stop - entry)
                extreme = high
            if (direction == "long" and stop >= entry) or (direction == "short" and stop <= entry):
                continue
            hits.append(
                PatternHit(
                    pattern=pattern,
                    direction=direction,
                    index=end,
                    entry=entry,
                    stop=stop,
                    target=target,
                    start=start,
                    extreme=extreme,
                    points=(Point(end, extreme),),
                )
            )
    return hits
