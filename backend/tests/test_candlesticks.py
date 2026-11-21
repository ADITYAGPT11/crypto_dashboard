"""Candlestick rules, one fixture per clause (Nison / StockCharts definitions, ``candlesticks.py``)."""

from __future__ import annotations

import pytest

from tcs.analysis.candlesticks import detect_candlesticks
from tcs.analysis.types import PatternHit
from tcs.common.series import Series, mirror

from .helpers import candles

Row = tuple[float, float, float, float]


def decline(n: int = 20, start: float = 120.0, step: float = 1.0) -> list[Row]:
    """Down candles of body ``step``: below the EMA(20) and falling more than 0.5 ATR in 5."""
    rows: list[Row] = []
    p = start
    for _ in range(n):
        rows.append((p, p + 0.4, p - step - 0.4, p - step))
        p -= step
    return rows


def rise(n: int = 20, start: float = 80.0, step: float = 1.0) -> list[Row]:
    rows: list[Row] = []
    p = start
    for _ in range(n):
        rows.append((p, p + step + 0.4, p - 0.4, p + step))
        p += step
    return rows


def flip(rows: list[Row]) -> list[Row]:
    """The rows upside down (what ``mirror`` does): a decline becomes a rise."""
    return [(-o, -lo, -h, -c) for o, h, lo, c in rows]


def hits(rows: list[Row]) -> list[PatternHit]:
    return detect_candlesticks(
        candles([(o + 500, h + 500, lo + 500, c + 500) for o, h, lo, c in rows])
    )


def found(rows: list[Row]) -> set[tuple[str, int]]:
    return {(h.pattern, h.index) for h in hits(rows)}


def confirm_up(rows: list[Row]) -> list[Row]:
    """One candle closing above everything so far in the pattern (the confirmation)."""
    top = max(h for _, h, _, _ in rows[-3:])
    c = rows[-1][3]
    return [*rows, (c, top + 1.2, c - 0.1, top + 1.0)]


# Patterns, each drawn after ``decline()`` (last close 100) ----------------------------------


def engulfing(rows: list[Row]) -> list[Row]:
    p = rows[-1][3]
    return [*rows, (p, p + 0.3, p - 1.5, p - 1.2), (p - 1.2, p + 1.2, p - 1.4, p + 0.9)]


def hammer(rows: list[Row], shadow: float = 3.0) -> list[Row]:
    p = rows[-1][3]
    return [*rows, (p, p + 0.55, p - shadow, p + 0.5)]  # body 0.5, upper 0.05, lower `shadow`


def inverted_hammer(rows: list[Row]) -> list[Row]:
    p = rows[-1][3]  # opens AT the prior close: no gap, as in every 24/7 market
    return [*rows, (p, p + 2.0, p - 0.05, p + 0.4)]


def morning_star(rows: list[Row], star_top: float = 0.0, third_close: float = 1.5) -> list[Row]:
    p = rows[-1][3]
    first = (p, p + 0.2, p - 2.2, p - 2.0)  # long down body 2.0, from p to p - 2
    so = p - 2.0 + star_top
    star = (so, so + 0.2, so - 0.6, so - 0.3)
    third = (so - 0.3, p - 2.0 + third_close + 0.1, so - 0.4, p - 2.0 + third_close)
    return [*rows, first, star, third]


def harami(rows: list[Row]) -> list[Row]:
    p = rows[-1][3]
    return [*rows, (p, p + 0.2, p - 2.2, p - 2.0), (p - 2.0, p - 1.2, p - 2.1, p - 1.4)]


class TestEngulfing:
    def test_confirmed_by_a_close_above_the_pattern(self) -> None:
        rows = confirm_up(engulfing(decline()))
        assert ("bullishEngulfing", len(rows) - 1) in found(rows)

    def test_no_signal_without_confirmation(self) -> None:
        rows = engulfing(decline())
        p = rows[-1][3]
        rows += [(p, p + 0.2, p - 0.3, p - 0.1)] * 3  # stays inside the pattern for 3 candles
        assert not any(k == "bullishEngulfing" for k, _ in found(rows))

    def test_cancelled_by_a_close_below_the_pattern_first(self) -> None:
        rows = engulfing(decline())
        p = rows[-1][3]
        rows += [(p, p + 0.1, p - 3.5, p - 3.2)]
        rows = confirm_up(rows)
        assert not any(k == "bullishEngulfing" for k, _ in found(rows))

    def test_needs_a_downtrend(self) -> None:
        rows = confirm_up(engulfing(rise()))
        assert not any(k == "bullishEngulfing" for k, _ in found(rows))

    def test_trend_needs_a_recent_drop_not_only_a_close_below_the_ema(self) -> None:
        rows = decline()
        p = rows[-1][3]
        rows += [(p, p + 0.4, p - 0.4, p)] * 6  # flat: still below the EMA, no drop in 5 candles
        assert not any(k == "bullishEngulfing" for k, _ in found(confirm_up(engulfing(rows))))

    def test_trend_needs_a_close_below_the_ema_not_only_a_drop(self) -> None:
        rows = rise(30)
        rows += decline(5, start=rows[-1][3])  # a 5-candle dip that stays above the EMA(20)
        assert not any(k == "bullishEngulfing" for k, _ in found(confirm_up(engulfing(rows))))

    def test_a_doji_is_not_engulfed(self) -> None:
        rows = decline()
        p = rows[-1][3]
        rows += [(p, p + 0.8, p - 0.8, p - 0.05), (p - 0.05, p + 1.2, p - 0.9, p + 0.9)]
        assert not any(k == "bullishEngulfing" for k, _ in found(confirm_up(rows)))

    def test_dust_candles_do_not_count(self) -> None:
        rows = decline()
        p = rows[-1][3]
        rows += [(p, p + 0.02, p - 0.06, p - 0.05), (p - 0.05, p + 0.04, p - 0.07, p + 0.03)]
        assert not any(k == "bullishEngulfing" for k, _ in found(confirm_up(rows)))

    def test_bearish_twin_after_a_rise(self) -> None:
        rows = flip(confirm_up(engulfing(decline())))
        assert ("bearishEngulfing", len(rows) - 1) in found(rows)


class TestHammerFamily:
    def test_hammer_needs_a_shadow_twice_the_body(self) -> None:
        ok = confirm_up(hammer(decline(), shadow=1.1))  # lower shadow 1.1 = 2.2 bodies
        assert ("hammer", len(ok) - 1) in found(ok)
        short = confirm_up(hammer(decline(), shadow=0.9))  # 1.8 bodies: TA-Lib's rule, not Nison's
        assert not any(k == "hammer" for k, _ in found(short))

    def test_inverted_hammer_needs_no_gap(self) -> None:
        rows = confirm_up(inverted_hammer(decline()))
        assert ("invertedHammer", len(rows) - 1) in found(rows)

    def test_shooting_star_is_the_hammer_upside_down(self) -> None:
        rows = flip(confirm_up(hammer(decline())))
        assert ("shootingStar", len(rows) - 1) in found(rows)

    def test_hanging_man_is_the_inverted_hammer_upside_down(self) -> None:
        rows = flip(confirm_up(inverted_hammer(decline())))
        assert ("hangingMan", len(rows) - 1) in found(rows)

    def test_no_hammer_without_a_downtrend(self) -> None:
        rows = confirm_up(hammer(rise()))
        assert not any(k == "hammer" for k, _ in found(rows))


class TestMorningStar:
    def test_confirms_on_its_third_candle(self) -> None:
        rows = morning_star(decline())
        assert ("morningStar", len(rows) - 1) in found(rows)

    def test_star_body_may_not_overlap_the_first_body(self) -> None:
        rows = morning_star(decline(), star_top=0.5)  # star opens 0.5 into the first body
        assert not any(k == "morningStar" for k, _ in found(rows))

    def test_third_candle_closes_past_the_middle_of_the_first(self) -> None:
        rows = morning_star(decline(), third_close=0.8)  # 40% into the first body
        assert not any(k == "morningStar" for k, _ in found(rows))

    def test_evening_star_is_the_mirror(self) -> None:
        rows = flip(morning_star(decline()))
        assert ("eveningStar", len(rows) - 1) in found(rows)


class TestHarami:
    def test_small_body_inside_a_long_down_body(self) -> None:
        rows = confirm_up(harami(decline()))
        assert ("bullishHarami", len(rows) - 1) in found(rows)

    def test_bearish_twin(self) -> None:
        rows = flip(confirm_up(harami(decline())))
        assert ("bearishHarami", len(rows) - 1) in found(rows)


def test_plan_enters_on_confirmation_with_stop_beyond_the_pattern_and_1_5r_target() -> None:
    rows = confirm_up(engulfing(decline()))
    h = next(h for h in hits(rows) if h.pattern == "bullishEngulfing")
    assert h.entry == pytest.approx(rows[-1][3] + 500)  # the confirmation close
    assert h.start == len(rows) - 3  # the pattern's first candle
    assert h.stop < h.extreme
    assert (h.target - h.entry) / (h.entry - h.stop) == pytest.approx(1.5)


def test_bearish_hits_are_the_bullish_rule_on_the_mirrored_series() -> None:
    from .helpers import random_walk

    s: Series = random_walk(21, 3000)
    twins = {
        "bearishEngulfing": "bullishEngulfing",
        "shootingStar": "hammer",
        "hangingMan": "invertedHammer",
        "eveningStar": "morningStar",
        "bearishHarami": "bullishHarami",
    }
    bear = {(twins[h.pattern], h.index) for h in detect_candlesticks(s) if h.direction == "short"}
    on_mirror = {
        (h.pattern, h.index) for h in detect_candlesticks(mirror(s)) if h.direction == "long"
    }
    assert bear and bear == on_mirror
