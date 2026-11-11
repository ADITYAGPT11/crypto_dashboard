"""Each rule clause of the chart patterns, one fixture per clause (ported from the TS suite)."""

from __future__ import annotations

import pytest

from tcs.analysis.chart_patterns import detect_chart_patterns
from tcs.analysis.types import PatternHit
from tcs.common.series import Series, mirror

from .helpers import path


def of(s: Series, pattern: str, after: int = 0) -> list[PatternHit]:
    return [h for h in detect_chart_patterns(s) if h.pattern == pattern and h.index > after]


W = [(0, 110), (20, 90), (30, 100), (40, 90.3), (52, 104), (60, 103)]


class TestDoubleBottom:
    def test_confirms_on_close_above_the_peak_with_measured_move(self) -> None:
        hits = of(path(W), "doubleBottom")
        assert len(hits) == 1
        h = hits[0]
        assert h.direction == "long"
        assert h.index >= 40 + 3  # second low known 3 candles later
        neckline = h.lines[0].a.price
        assert h.entry > neckline
        assert h.stop < h.extreme
        assert h.target == pytest.approx(neckline + (neckline - h.extreme))

    def test_needs_a_meaningful_peak_between_the_lows(self) -> None:
        shallow = path([(0, 110), (20, 90), (30, 91.5), (40, 90.3), (52, 104)])
        assert of(shallow, "doubleBottom") == []

    def test_lows_must_be_close_together(self) -> None:
        uneven = path([(0, 110), (20, 90), (30, 100), (40, 95), (52, 104)])
        assert of(uneven, "doubleBottom") == []

    def test_no_signal_when_price_breaks_the_lows_first(self) -> None:
        failed = path([(0, 110), (20, 90), (30, 100), (40, 90.3), (46, 93), (50, 86), (64, 104)])
        assert of(failed, "doubleBottom", after=40) == []

    def test_double_top_is_the_mirror(self) -> None:
        tops = of(mirror(path(W)), "doubleTop")
        bottoms = of(path(W), "doubleBottom")
        assert [(t.index, t.direction) for t in tops] == [(b.index, "short") for b in bottoms]
        assert tops[0].entry == pytest.approx(-bottoms[0].entry)


IHS = [(0, 104), (20, 90), (28, 96), (38, 84), (48, 96.5), (56, 90.5), (70, 100), (80, 99)]


class TestInverseHeadShoulders:
    def test_confirms_above_the_neckline(self) -> None:
        hits = of(path(IHS), "inverseHeadShoulders")
        assert len(hits) == 1
        h = hits[0]
        assert h.index > 56 + 3
        assert h.extreme == pytest.approx(83.5)  # head low
        assert h.stop < 90  # below the right shoulder
        assert h.target > h.entry

    def test_head_must_be_lower_than_both_shoulders(self) -> None:
        flat = path([(0, 104), (20, 90), (28, 96), (38, 89.8), (48, 96.5), (56, 90.5), (70, 100)])
        assert of(flat, "inverseHeadShoulders") == []

    def test_needs_a_neckline_break(self) -> None:
        stuck = path([(0, 104), (20, 90), (28, 96), (38, 84), (48, 96.5), (56, 90.5), (70, 94)])
        assert of(stuck, "inverseHeadShoulders") == []

    def test_fails_when_right_shoulder_breaks_first(self) -> None:
        failed = path(
            [
                (0, 104),
                (20, 90),
                (28, 96),
                (38, 84),
                (48, 96.5),
                (56, 90.5),
                (61, 92),
                (64, 88),
                (80, 100),
            ]
        )
        assert of(failed, "inverseHeadShoulders", after=56) == []


FLAG = [(0, 100), (20, 100.2), (26, 112), (32, 109), (35, 114), (45, 115)]


class TestBullFlag:
    def test_confirms_above_the_pause_with_pole_target(self) -> None:
        hits = of(path(FLAG), "bullFlag")
        assert len(hits) == 1
        h = hits[0]
        assert h.index >= 26 + 4
        assert h.entry > h.lines[0].a.price
        assert h.stop < h.extreme
        pole = h.points[1].price - h.points[0].price
        assert h.target - h.entry == pytest.approx(pole)

    def test_pause_may_not_give_back_more_than_half(self) -> None:
        deep = path([(0, 100), (20, 100.2), (26, 112), (32, 104), (35, 114)])
        assert of(deep, "bullFlag") == []

    def test_needs_a_real_pole(self) -> None:
        weak = path([(0, 100), (20, 100.2), (26, 102), (32, 101), (35, 103)])
        assert of(weak, "bullFlag") == []

    def test_bear_flag_is_the_mirror(self) -> None:
        assert [h.index for h in of(mirror(path(FLAG)), "bearFlag")] == [
            h.index for h in of(path(FLAG), "bullFlag")
        ]
