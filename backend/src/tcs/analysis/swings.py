"""Swing highs and lows (fractal pivots) with their confirmation delay.

A swing low at ``i`` is the lowest low of the ``SWING_BARS`` candles on each
side. It only becomes KNOWN when candle ``i + SWING_BARS`` closes; detectors
must not use a swing before then (``Swing.known_at``).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from tcs.common.series import FloatArray, Series

SWING_BARS = 3


@dataclass(frozen=True, slots=True)
class Swing:
    index: int
    price: float
    kind: Literal["high", "low"]

    @property
    def known_at(self) -> int:
        return self.index + SWING_BARS


def _is_pivot(values: FloatArray, i: int, k: int, lowest: bool) -> bool:
    n = values.shape[0]
    if i - k < 0 or i + k >= n:
        return False
    v = values[i]
    for j in range(i - k, i + k + 1):
        if j == i:
            continue
        w = values[j]
        # Strict on the left, non-strict on the right: a flat bottom counts once (its first bar).
        if lowest:
            if (w <= v) if j < i else (w < v):
                return False
        elif (w >= v) if j < i else (w > v):
            return False
    return True


def swing_lows(s: Series, k: int = SWING_BARS) -> list[Swing]:
    return [Swing(i, float(s.low[i]), "low") for i in range(len(s)) if _is_pivot(s.low, i, k, True)]


def swing_highs(s: Series, k: int = SWING_BARS) -> list[Swing]:
    return [
        Swing(i, float(s.high[i]), "high") for i in range(len(s)) if _is_pivot(s.high, i, k, False)
    ]
