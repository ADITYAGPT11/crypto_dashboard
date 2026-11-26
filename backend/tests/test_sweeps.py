"""Liquidity sweeps (``sweeps.py``, r13): one fixture per clause."""

from __future__ import annotations

from tcs.analysis.sweeps import detect_sweeps
from tcs.analysis.types import PatternHit
from tcs.common.series import Series, mirror

from .helpers import candles, path

Row = tuple[float, float, float, float]


def rows_of(s: Series) -> list[Row]:
    return [
        (float(s.open[i]), float(s.high[i]), float(s.low[i]), float(s.close[i]))
        for i in range(len(s))
    ]


# A fall to an obvious low at 25 (89.5 with its wick), a bounce, a drift back down to 92.
BASE = rows_of(path([(0, 110), (25, 90), (35, 100), (45, 92)]))


def with_candle(row: Row, base: list[Row] = BASE) -> Series:
    """The base path, one more candle, and a quiet one after it."""
    c = row[3]
    return candles([*base, row, (c, c + 0.5, c - 0.5, c)])


def sweeps(s: Series) -> list[PatternHit]:
    return [h for h in detect_sweeps(s) if h.direction == "long"]


def test_a_wick_through_the_low_closing_back_above_is_a_sweep() -> None:
    found = sweeps(with_candle((92.0, 93.0, 88.5, 92.5)))
    assert [(h.pattern, h.index) for h in found] == [("bullishSweep", 45)]
    h = found[0]
    swing, wick = h.points
    assert swing.label == "Swing low" and swing.price == 89.5
    assert wick.price == 88.5
    assert h.stop < h.extreme < h.entry < h.target


def test_closing_below_the_low_is_a_break_not_a_sweep() -> None:
    assert sweeps(with_candle((92.0, 92.5, 88.0, 89.0))) == []


def test_a_one_tick_poke_is_not_enough() -> None:
    # 0.01 below the low: under 0.1 ATR.
    assert sweeps(with_candle((92.0, 93.0, 89.49, 92.5))) == []


def test_only_an_obvious_low_counts() -> None:
    # The same shape after a lower low 10 candles earlier: 89.5 is no longer the lowest of the
    # 20 candles before it, so it is not where stops gather.
    base = [*BASE]
    o, h, _lo, c = base[15]
    base[15] = (o, h, 85.0, c)
    s = with_candle((92.0, 93.0, 88.5, 92.5), base)
    assert sweeps(s) == []


def test_a_low_already_taken_cannot_be_swept_again() -> None:
    first = with_candle((92.0, 93.0, 88.5, 92.5))
    again = candles([*rows_of(first), (92.0, 93.0, 88.4, 92.5), (92.5, 93.0, 92.0, 92.5)])
    assert [h.index for h in sweeps(again)] == [45]


def test_bearish_sweep_is_the_mirror() -> None:
    s = mirror(with_candle((92.0, 93.0, 88.5, 92.5)))
    assert [(h.pattern, h.direction, h.index) for h in detect_sweeps(s)] == [
        ("bearishSweep", "short", 45)
    ]
    assert [p.label for p in detect_sweeps(s)[0].points] == ["Swing high", "Sweep"]
