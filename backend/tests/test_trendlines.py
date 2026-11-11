"""Triangles and wedges: classification by slope, breakout, containment, convergence."""

from __future__ import annotations

from tcs.analysis.trendlines import detect_trendline_patterns
from tcs.analysis.types import PatternHit
from tcs.common.series import Series, mirror

from .helpers import path


def kinds(s: Series) -> list[tuple[str, str]]:
    return [(h.pattern, h.direction) for h in detect_trendline_patterns(s)]


def hits(s: Series, pattern: str) -> list[PatternHit]:
    return [h for h in detect_trendline_patterns(s) if h.pattern == pattern]


# Flat top at ~110, rising lows 100 -> 103 -> 106, breakout to 116.
ASC = [
    (0, 96),
    (8, 100),
    (16, 110),
    (24, 103),
    (32, 110),
    (40, 106),
    (48, 110.2),
    (54, 116),
    (60, 117),
]
# Falling highs 114 -> 111 -> 108, rising lows 100 -> 102.5 -> 105, breakout up.
SYM = [
    (0, 98),
    (6, 100),
    (14, 114),
    (22, 102.5),
    (30, 111),
    (38, 105),
    (46, 108),
    (52, 114),
    (58, 115),
]
# Both lines falling, upper steeper: highs 120 -> 113 -> 108, lows 110 -> 106 -> 103.5.
WEDGE = [
    (0, 118),
    (6, 120),
    (14, 110),
    (22, 113),
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


def test_no_breakout_no_signal() -> None:
    stuck = path([*ASC[:7], (54, 108), (60, 109)])
    assert hits(stuck, "ascendingTriangle") == []


def test_parallel_lines_are_a_channel_not_a_triangle() -> None:
    channel = path(
        [(0, 96), (8, 100), (16, 110), (24, 100), (32, 110), (40, 100), (48, 110.1), (54, 116)]
    )
    assert [k for k in kinds(channel) if k[0].endswith("Triangle") or k[0].endswith("Wedge")] == []
