"""Triangles and wedges: classification by slope, breakout, containment, convergence."""

from __future__ import annotations

import pytest

from tcs.analysis.trendlines import detect_trendline_patterns
from tcs.analysis.types import PatternHit
from tcs.common.series import Series, mirror

from .helpers import path


def kinds(s: Series) -> list[tuple[str, str]]:
    return [(h.pattern, h.direction) for h in detect_trendline_patterns(s)]


def hits(s: Series, pattern: str) -> list[PatternHit]:
    return [h for h in detect_trendline_patterns(s) if h.pattern == pattern]


# Flat top at ~110, rising lows 100 -> 103 -> 106, breakout to 116. Five touches (3 lows, 2 highs)
# are known before the breakout; the third high at 48 only becomes a swing after it.
ASC = [
    (0, 104),
    (8, 100),
    (16, 110),
    (24, 103),
    (32, 110),
    (40, 106),
    (48, 110.2),
    (54, 116),
    (60, 117),
]
# Falling highs 114 -> 112, rising lows 100 -> 103 -> 106, breakout up about 70% of the way to
# the apex (r12: not in the last quarter).
SYM: list[tuple[int, float]] = [
    (0, 104),
    (6, 100),
    (14, 114),
    (22, 103),
    (30, 112),
    (38, 106),
    (44, 116),
    (50, 117),
]
# Both lines falling, upper steeper: highs 120 -> 114 -> 108, lows 110 -> 106 -> 103.5.
WEDGE = [
    (0, 118),
    (6, 120),
    (14, 110),
    (22, 114),
    (30, 106),
    (38, 108),
    (46, 103.5),
    (52, 111),
    (58, 113),
]


def test_ascending_triangle_breaks_up() -> None:
    found = hits(path(ASC), "ascendingTriangle")
    assert len(found) == 1
    h = found[0]
    assert h.direction == "long"
    upper, lower = h.lines
    assert abs(upper.b.price - upper.a.price) < 2  # flat resistance
    assert lower.b.price > lower.a.price  # rising support
    assert h.entry > upper.b.price
    assert h.target - h.entry > 5  # measured move: height at the start


def test_symmetrical_triangle_breaks_up() -> None:
    assert ("symmetricalTriangle", "long") in kinds(path(SYM))


def test_falling_wedge_targets_its_start() -> None:
    found = hits(path(WEDGE), "fallingWedge")
    assert len(found) == 1
    assert found[0].target > found[0].entry


def test_mirrors_are_the_bearish_twins() -> None:
    assert ("descendingTriangle", "short") in kinds(mirror(path(ASC)))
    assert ("symmetricalTriangle", "short") in kinds(mirror(path(SYM)))
    assert ("risingWedge", "short") in kinds(mirror(path(WEDGE)))


def test_four_touches_are_not_enough() -> None:
    # Two highs and two lows only: Bulkowski asks for five touches (3 + 2) (r11).
    two_by_two = path([(0, 98), (6, 100), (14, 114), (22, 102.5), (30, 111), (38, 105), (44, 114)])
    assert [
        k for k in kinds(two_by_two) if k[0].endswith("Triangle") or k[0].endswith("Wedge")
    ] == []


def test_against_the_bias_breakout_is_a_signal_that_way() -> None:
    # r12: an ascending triangle breaking DOWN is an ascending triangle, short (Bulkowski);
    # its mirror, a descending triangle breaking up, is a descending triangle, long.
    down = [*ASC[:7], (54, 100), (60, 98)]
    assert ("ascendingTriangle", "short") in kinds(path(down))
    assert ("descendingTriangle", "long") in kinds(mirror(path(down)))


def test_no_breakout_in_the_last_quarter_before_the_apex() -> None:
    # The same triangle with the breakout delayed until the lines are under a quarter of their
    # starting width apart: too late (Edwards & Magee).
    late = [*ASC[:7], (56, 109.6), (64, 109.8), (70, 118)]
    assert hits(path(late), "ascendingTriangle") == []


def test_no_breakout_no_signal() -> None:
    # The data ends inside the triangle (since r12 a break down would be a short signal).
    stuck = path([*ASC[:7], (52, 108.5)])
    assert hits(stuck, "ascendingTriangle") == []


# Flat lines at 100 and 110, three lows and two highs known at the breakout (r13).
RECT: list[tuple[int, float]] = [
    (0, 104),
    (8, 100),
    (16, 110),
    (24, 100),
    (32, 110),
    (40, 100),
    (48, 110.1),
    (54, 116),
]
# Both lines rising 0.25 a candle, 10 apart.
RISING_CHANNEL: list[tuple[int, float]] = [
    (0, 104),
    (8, 100),
    (16, 110),
    (24, 104),
    (32, 114),
    (40, 108),
    (48, 118.2),
    (54, 126),
]


def test_parallel_flat_lines_are_a_rectangle_not_a_triangle() -> None:
    found = kinds(path(RECT))
    assert found == [("rectangle", "long")]
    h = hits(path(RECT), "rectangle")[0]
    assert h.target - h.entry == pytest.approx(11, abs=1)  # height at the breakout


def test_rectangle_breaks_either_way() -> None:
    assert kinds(path([*RECT[:7], (54, 94)])) == [("rectangle", "short")]
    assert kinds(mirror(path(RECT))) == [("rectangle", "short")]


def test_parallel_sloping_lines_are_a_channel() -> None:
    assert kinds(path(RISING_CHANNEL)) == [("risingChannel", "long")]
    assert kinds(mirror(path(RISING_CHANNEL))) == [("fallingChannel", "short")]


def test_a_channel_needs_five_touches() -> None:
    # The rectangle without its first low: 2 + 2 touches.
    assert kinds(path([(0, 96), *RECT[1:]])) == []
