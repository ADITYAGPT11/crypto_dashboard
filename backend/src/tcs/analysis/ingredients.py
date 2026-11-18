"""Ingredients: single, simple signals, measured on their own before anything is combined.

Each ingredient turns a coin's 4h candles (plus daily levels and funding rates) into a direction
per candle: +1 (long), -1 (short) or 0 (nothing), using only what was known when that candle
closed. ``ingredient_stats`` then measures what price did next. The question is not "is this a
strategy" but "does this ingredient tell anything about direction at all, before costs"; only
ingredients that do are worth combining.

Two kinds: a **state** is on every candle (trend side, momentum sign); an **event** fires on
particular candles (a cross, a breakout, a sweep, a pattern). ``always_long`` is the reference:
the market's own drift over the period, which any long-biased ingredient also collects.
"""

from __future__ import annotations

import bisect
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal

import numpy as np
import numpy.typing as npt
import talib

from tcs.analysis.engine import analyze
from tcs.analysis.flow import DELTA_RATIO, divergence_at
from tcs.analysis.indicators import ema
from tcs.analysis.swings import swing_lows
from tcs.common.series import Series, mirror

#: Bump when any ingredient's rule changes (research results are stored per version).
INGREDIENTS_VERSION = "ing-2026.11-1"

Signal = npt.NDArray[np.int8]
Kind = Literal["state", "event"]


@dataclass(frozen=True, slots=True)
class Ingredient:
    id: str
    label: str
    kind: Kind
    rule: str


INGREDIENTS: tuple[Ingredient, ...] = (
    Ingredient(
        "always_long", "Always long (market drift)", "state", "Long on every candle: the reference."
    ),
    Ingredient(
        "trend_ema200",
        "Trend: side of the 200 EMA",
        "state",
        "Long above the 4h 200 EMA, short below.",
    ),
    Ingredient(
        "ema_cross",
        "EMA 50 / 200 cross",
        "event",
        "Long on the candle the 50 EMA crosses above the 200, short below.",
    ),
    Ingredient(
        "momentum_1d",
        "Momentum, 1 day",
        "state",
        "Long when the last 6 candles (1 day) rose, short when they fell.",
    ),
    Ingredient(
        "momentum_1w",
        "Momentum, 1 week",
        "state",
        "Long when the last 42 candles (1 week) rose, short when they fell.",
    ),
    Ingredient(
        "breakout_20",
        "20-candle breakout",
        "event",
        "Long on a close above the previous 20 highs, short below the 20 lows.",
    ),
    Ingredient(
        "rsi_extreme",
        "RSI extreme (reversal)",
        "event",
        "Long when RSI 14 is below 30, short above 70.",
    ),
    Ingredient(
        "delta_3",
        "Delta, 3 candles",
        "state",
        "Long when aggressive buying exceeded selling by 2% of volume over 3 candles, short the opposite.",
    ),
    Ingredient(
        "cvd_divergence",
        "CVD divergence",
        "event",
        "Long on a lower low that CVD did not confirm, short on the mirrored case.",
    ),
    Ingredient(
        "liquidity_sweep",
        "Liquidity sweep",
        "event",
        "Long when a candle trades below the last swing low and closes back above it, short at swing highs.",
    ),
    Ingredient(
        "funding_extreme",
        "Funding extreme (contrarian)",
        "event",
        "Short when funding is in its top 5% of the last 90 days (crowded longs), long in the bottom 5%.",
    ),
    Ingredient(
        "pattern_daily_level",
        "Pattern at a daily level",
        "event",
        "The pattern's own direction, when it confirms at a daily zone or order block.",
    ),
    Ingredient(
        "pattern_open_space",
        "Pattern in open space",
        "event",
        "The pattern's own direction, away from any daily level (comparison).",
    ),
)
BY_ID = {i.id: i for i in INGREDIENTS}

FUNDING_WINDOW_MS = 90 * 86_400_000
FUNDING_MIN_POINTS = 90
FUNDING_TAIL = 0.05


def _zeros(n: int) -> Signal:
    return np.zeros(n, dtype=np.int8)


def _sign(x: npt.NDArray[np.float64]) -> Signal:
    out = np.sign(np.nan_to_num(x, nan=0.0)).astype(np.int8)
    return out


def _cross(fast: npt.NDArray[np.float64], slow: npt.NDArray[np.float64]) -> Signal:
    out = _zeros(len(fast))
    above = fast > slow
    valid = np.isfinite(fast) & np.isfinite(slow)
    for i in range(1, len(fast)):
        if valid[i] and valid[i - 1] and above[i] != above[i - 1]:
            out[i] = 1 if above[i] else -1
    return out


def _momentum(c: npt.NDArray[np.float64], k: int) -> Signal:
    out = _zeros(len(c))
    if len(c) > k:
        out[k:] = _sign(c[k:] / c[:-k] - 1)
    return out


def _breakout(s: Series, k: int = 20) -> Signal:
    out = _zeros(len(s))
    for i in range(k, len(s)):
        if s.close[i] > np.max(s.high[i - k : i]):
            out[i] = 1
        elif s.close[i] < np.min(s.low[i - k : i]):
            out[i] = -1
    return out


def _rsi_extreme(c: npt.NDArray[np.float64]) -> Signal:
    out = _zeros(len(c))
    if len(c) <= 14:
        return out
    r = np.asarray(talib.RSI(c, timeperiod=14), dtype=np.float64)
    out[r < 30] = 1
    out[r > 70] = -1
    return out


def _delta(s: Series, k: int = 3) -> Signal:
    out = _zeros(len(s))
    if s.taker_buy is None:
        return out
    d = 2 * s.taker_buy - s.volume
    for i in range(k - 1, len(s)):
        vol = float(np.sum(s.volume[i - k + 1 : i + 1]))
        dd = float(np.sum(d[i - k + 1 : i + 1]))
        if vol > 0 and np.isfinite(dd):
            r = dd / vol
            out[i] = 1 if r >= DELTA_RATIO else -1 if r <= -DELTA_RATIO else 0
    return out


def _cvd_div(s: Series) -> Signal:
    out = _zeros(len(s))
    m = mirror(s)
    for i in range(len(s)):
        if divergence_at(s, i):
            out[i] = 1
        elif divergence_at(m, i):
            out[i] = -1
    return out


def _sweep_long(s: Series) -> Signal:
    """+1 where a candle trades below the latest known swing low and closes back above it (the
    first time that swing is swept)."""
    out = _zeros(len(s))
    lows = swing_lows(s)
    known = [w.known_at for w in lows]
    swept: set[int] = set()
    for i in range(len(s)):
        k = bisect.bisect_right(known, i - 1)
        if k == 0:
            continue
        w = lows[k - 1]
        if w.index in swept:
            continue
        if s.low[i] < w.price < s.close[i]:
            out[i] = 1
            swept.add(w.index)
    return out


def _sweep(s: Series) -> Signal:
    up = _sweep_long(s)
    down = _sweep_long(mirror(s))
    out = up.copy()
    out[(down == 1) & (up == 0)] = -1
    return out


def _funding(s: Series, funding: Sequence[tuple[int, float]]) -> Signal:
    out = _zeros(len(s))
    if not funding:
        return out
    times = [t for t, _ in funding]
    rates = np.array([r for _, r in funding], dtype=np.float64)
    for i in range(len(s)):
        close_t = s.close_time(i)
        k = bisect.bisect_right(times, close_t)  # funding known by this close
        if k == 0:
            continue
        lo = bisect.bisect_left(times, times[k - 1] - FUNDING_WINDOW_MS)
        window = rates[lo:k]
        if len(window) < FUNDING_MIN_POINTS:
            continue
        now = rates[k - 1]
        if now >= np.quantile(window, 1 - FUNDING_TAIL):
            out[i] = -1
        elif now <= np.quantile(window, FUNDING_TAIL):
            out[i] = 1
    return out


def _patterns(s: Series, levels: Series | None) -> tuple[Signal, Signal]:
    at, away = _zeros(len(s)), _zeros(len(s))
    if levels is None or len(levels) == 0:
        return at, away
    for o in analyze(s, level_series=levels).occurrences:
        d = 1 if o.hit.direction == "long" else -1
        target = away if o.location == "openSpace" else at
        target[o.hit.index] = d
    return at, away


def signals(
    s: Series, levels: Series | None = None, funding: Sequence[tuple[int, float]] = ()
) -> dict[str, Signal]:
    """Every ingredient's direction per candle of ``s`` (4h), known at that candle's close."""
    n = len(s)
    e50, e200 = ema(s.close, 50), ema(s.close, 200)
    trend = _zeros(n)
    ok = np.isfinite(e200)
    trend[ok & (s.close > e200)] = 1
    trend[ok & (s.close < e200)] = -1
    at, away = _patterns(s, levels)
    return {
        "always_long": np.ones(n, dtype=np.int8),
        "trend_ema200": trend,
        "ema_cross": _cross(e50, e200),
        "momentum_1d": _momentum(s.close, 6),
        "momentum_1w": _momentum(s.close, 42),
        "breakout_20": _breakout(s),
        "rsi_extreme": _rsi_extreme(s.close),
        "delta_3": _delta(s),
        "cvd_divergence": _cvd_div(s),
        "liquidity_sweep": _sweep(s),
        "funding_extreme": _funding(s, funding),
        "pattern_daily_level": at,
        "pattern_open_space": away,
    }
