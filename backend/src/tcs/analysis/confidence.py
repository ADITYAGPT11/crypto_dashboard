"""Confidence checks: four yes/no facts about a setup, counted into a score of 0-4.

The chart shows the measured win rate of past setups of the same pattern, direction and score
(``stats_job``: context ``score:<n>``), never a weighted guess. Each check was kept only because
it lifted the win rate in BOTH halves of a two-year sample (10 coins, 1h and 4h, every pattern
pooled; ``docs/context/DECISIONS.md`` 2026-11-22). Zones and "strong" zones were tested and
dropped (no lift); a volume spike and an oversold RSI LOWERED the win rate, so the kept checks
are their opposites.

All four use only candles up to the confirmation candle. Written for longs; shorts read the
mirrored series (``tcs.common.series.mirror``), where the same rule means the opposite side.

- **with_trend**: the confirmation close is on the trade's side of the EMA(``TREND_EMA``).
- **flow_agrees**: aggressive volume over the last candles leans the trade's way
  (``flow.py`` delta ``confirms``).
- **calm_volume**: no candle from the pattern's first to the confirmation traded
  ``SPIKE`` x the mean volume of the ``VOLUME_BARS`` candles before the pattern.
- **not_stretched**: RSI(``RSI_PERIOD``) stayed above ``RSI_STRETCHED`` through the pattern
  (no capitulation against the trade).
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

import numpy as np
import talib

from tcs.analysis.flow import FlowContext
from tcs.analysis.indicators import ema
from tcs.analysis.types import PatternHit
from tcs.common.series import FloatArray, Series

TREND_EMA = 200
VOLUME_BARS = 20
SPIKE = 1.5
RSI_PERIOD = 14
RSI_STRETCHED = 35.0
MAX_SCORE = 4

#: Statistics context of every score, in order (``score:0`` .. ``score:4``).
SCORE_CONTEXTS: tuple[str, ...] = tuple(f"score:{n}" for n in range(MAX_SCORE + 1))


@dataclass(frozen=True, slots=True)
class Score:
    with_trend: bool
    flow_agrees: bool
    calm_volume: bool
    not_stretched: bool

    @property
    def total(self) -> int:
        return sum((self.with_trend, self.flow_agrees, self.calm_volume, self.not_stretched))

    @property
    def context(self) -> str:
        return f"score:{self.total}"


class _Side:
    """Indicators of one side (the series itself for longs, its mirror for shorts), once."""

    def __init__(self, s: Series) -> None:
        self.close = s.close
        self.trend: FloatArray = ema(s.close, TREND_EMA)
        self.rsi: FloatArray = np.asarray(talib.RSI(s.close, timeperiod=RSI_PERIOD), np.float64)


def scorer(s: Series, mirrored: Series | None) -> Callable[[PatternHit, FlowContext], Score]:
    """Build once per series; returns the score of any hit on it."""
    long = _Side(s)
    short = _Side(mirrored) if mirrored is not None else None
    volume = s.volume

    def score(hit: PatternHit, flow: FlowContext) -> Score:
        side = long if hit.direction == "long" else short
        if side is None:
            raise ValueError("a short hit needs the mirrored series")
        i, start = hit.index, hit.start
        e = float(side.trend[i])
        with_trend = bool(np.isfinite(e) and side.close[i] > e)
        base = volume[max(0, start - VOLUME_BARS) : start]
        calm = bool(
            len(base) == VOLUME_BARS
            and float(volume[start : i + 1].max()) < SPIKE * float(base.mean())
        )
        r = side.rsi[start : i + 1]
        not_stretched = bool(np.isfinite(r).all() and float(r.min()) > RSI_STRETCHED)
        return Score(with_trend, flow.flow == "confirms", calm, not_stretched)

    return score
