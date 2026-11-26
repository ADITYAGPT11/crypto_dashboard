"""Each rule clause of the chart patterns, one fixture per clause (ported from the TS suite)."""

from __future__ import annotations

from dataclasses import replace

import numpy as np
import pytest

from tcs.analysis import chart_patterns
from tcs.analysis.chart_patterns import detect_chart_patterns, double_bottoms
from tcs.analysis.indicators import atr
from tcs.analysis.swings import SWING_BARS, swing_lows
from tcs.analysis.types import PatternHit
from tcs.common.series import Series, mirror

from .helpers import candles, path


def of(s: Series, pattern: str, after: int = 0) -> list[PatternHit]:
    return [h for h in detect_chart_patterns(s) if h.pattern == pattern and h.index > after]


def falling_into(points: list[tuple[int, float]]) -> Series:
    """The path with a 10-candle decline in front: reversals need a trend to reverse."""
    return path([(0, points[0][1] + 10), *((i + 10, p) for i, p in points)])


W = [(0, 110), (20, 90), (30, 100), (40, 90.3), (52, 104), (60, 103)]


class TestDoubleBottom:
    def test_confirms_on_close_above_the_peak_with_measured_move(self) -> None:
        hits = of(falling_into(W), "doubleBottom")
        assert len(hits) == 1
        h = hits[0]
        assert h.direction == "long"
        assert h.index >= 50 + 3  # second low known 3 candles later
        neckline = h.lines[0].a.price
        assert h.entry > neckline
        assert h.stop < h.extreme
        assert h.target == pytest.approx(neckline + (neckline - h.extreme))

    def test_needs_a_meaningful_peak_between_the_lows(self) -> None:
        shallow = falling_into([(0, 110), (20, 90), (30, 91.5), (40, 90.3), (52, 104)])
        assert of(shallow, "doubleBottom") == []

    def test_a_lows_own_wick_is_not_the_peak(self) -> None:
        # The first low's candle has a tall upper wick (2 ATR); between the lows price only
        # drifts. One long candle and a retest is not a W (r11).
        s = falling_into([(0, 110), (20, 90), (26, 91.5), (32, 90.3), (44, 104)])
        i = 20 + int(np.argmin(s.low[20:36]))  # the first low's candle
        high = s.high.copy()
        high[i] = 100.0
        assert of(replace(s, high=high), "doubleBottom") == []

    def test_lows_must_be_close_together(self) -> None:
        uneven = falling_into([(0, 110), (20, 90), (30, 100), (40, 95), (52, 104)])
        assert of(uneven, "doubleBottom") == []

    def test_no_signal_when_price_breaks_the_lows_first(self) -> None:
        failed = falling_into(
            [(0, 110), (20, 90), (30, 100), (40, 90.3), (46, 93), (50, 86), (64, 104)]
        )
        assert of(failed, "doubleBottom", after=50) == []

    def test_needs_a_decline_into_the_first_low(self) -> None:
        flat = path([(0, 91), (12, 90.6), (20, 90), (30, 100), (40, 90.3), (52, 104), (60, 103)])
        assert of(flat, "doubleBottom") == []

    def test_double_top_is_the_mirror(self) -> None:
        tops = of(mirror(falling_into(W)), "doubleTop")
        bottoms = of(falling_into(W), "doubleBottom")
        assert bottoms
        assert [(t.index, t.direction) for t in tops] == [(b.index, "short") for b in bottoms]
        assert tops[0].entry == pytest.approx(-bottoms[0].entry)


TRIPLE = [(0, 110), (14, 90), (22, 100), (30, 90.2), (38, 100.3), (46, 90.1), (56, 104), (62, 103)]


class TestTripleBottom:
    def test_confirms_above_the_higher_peak(self) -> None:
        hits = of(falling_into(TRIPLE), "tripleBottom")
        assert len(hits) == 1
        h = hits[0]
        assert [p.label for p in h.points][::2] == ["Bottom 1", "Bottom 2", "Bottom 3"]
        assert h.entry > h.lines[0].a.price  # closed above the higher peak
        assert h.target == pytest.approx(h.lines[0].a.price * 2 - h.extreme)

    def test_its_breakout_is_not_also_a_double_bottom(self) -> None:
        s = falling_into(TRIPLE)
        triple = of(s, "tripleBottom")[0]
        assert [h for h in of(s, "doubleBottom") if h.index == triple.index] == []
        # ... though two of its lows alone do make one (the suppression is what removes it).
        lows = swing_lows(s, SWING_BARS)
        assert any(h.index == triple.index for h in double_bottoms(s, atr(s), lows))

    def test_third_low_must_be_near_the_others(self) -> None:
        uneven = falling_into([*TRIPLE[:5], (46, 94), (56, 104), (62, 103)])
        assert of(uneven, "tripleBottom") == []

    def test_triple_top_is_the_mirror(self) -> None:
        tops = of(mirror(falling_into(TRIPLE)), "tripleTop")
        assert [(t.index, t.direction) for t in tops] == [
            (h.index, "short") for h in of(falling_into(TRIPLE), "tripleBottom")
        ]


IHS = [(0, 104), (20, 90), (28, 96), (38, 84), (48, 96.5), (56, 90.5), (70, 100), (80, 99)]


class TestInverseHeadShoulders:
    def test_confirms_above_the_neckline(self) -> None:
        hits = of(falling_into(IHS), "inverseHeadShoulders")
        assert len(hits) == 1
        h = hits[0]
        assert h.index > 66 + 3
        assert h.extreme == pytest.approx(83.5)  # head low
        assert h.stop < 90  # below the right shoulder
        assert h.target > h.entry

    def test_head_must_be_lower_than_both_shoulders(self) -> None:
        flat = falling_into(
            [(0, 104), (20, 90), (28, 96), (38, 89.8), (48, 96.5), (56, 90.5), (70, 100)]
        )
        assert of(flat, "inverseHeadShoulders") == []

    def test_needs_a_neckline_break(self) -> None:
        stuck = falling_into(
            [(0, 104), (20, 90), (28, 96), (38, 84), (48, 96.5), (56, 90.5), (70, 94)]
        )
        assert of(stuck, "inverseHeadShoulders") == []

    def test_shoulders_must_be_alike_in_width(self) -> None:
        # r12: IHS with the right side squeezed: left shoulder 18 candles from the head, right
        # shoulder 8, more than twice as narrow (valid with the width check switched off).
        lopsided = falling_into(
            [(0, 104), (20, 90), (28, 96), (38, 84), (42, 96.5), (46, 90.5), (56, 100), (66, 99)]
        )
        assert of(lopsided, "inverseHeadShoulders") == []

    def test_fails_when_right_shoulder_breaks_first(self) -> None:
        failed = falling_into(
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
        assert of(failed, "inverseHeadShoulders", after=66) == []

    def test_needs_a_decline_into_the_left_shoulder(self) -> None:
        flat = path([(0, 90.5), (20, 90), *IHS[2:]])
        assert of(flat, "inverseHeadShoulders") == []


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

    def test_a_rising_pause_is_not_a_flag(self) -> None:
        rising = path([(0, 100), (20, 100.2), (26, 112), (28, 109), (34, 111.5), (37, 115)])
        assert of(rising, "bullFlag") == []

    def test_needs_a_real_pole(self) -> None:
        weak = path([(0, 100), (20, 100.2), (26, 102), (32, 101), (35, 103)])
        assert of(weak, "bullFlag") == []

    def test_bear_flag_is_the_mirror(self) -> None:
        assert [h.index for h in of(mirror(path(FLAG)), "bearFlag")] == [
            h.index for h in of(path(FLAG), "bullFlag")
        ]


def pole_and_pause(pause: list[tuple[float, float]]) -> Series:
    """A 12-point pole in 6 candles, the given (high, low) pause with level closes, a breakout."""
    rows = [(100.0, 100.5, 99.5, 100.0)] * 15
    rows += [(100.0 + 2 * i, 102.3 + 2 * i, 99.8 + 2 * i, 102.0 + 2 * i) for i in range(6)]
    rows += [(109.7, h, lo, 109.7) for h, lo in pause]
    rows += [(109.7, 113.5, 109.5, 113.2), (113.2, 114.0, 112.8, 113.8)]
    return candles(rows)


CONVERGING = [(112.4, 107.0), (111.9, 107.5), (111.4, 108.0), (110.9, 108.5), (110.4, 109.0)]


class TestPennant:
    def test_a_converging_pause_is_a_pennant(self) -> None:
        hits = of(pole_and_pause(CONVERGING), "bullPennant")
        assert len(hits) == 1
        upper, lower = hits[0].lines
        assert upper.b.price < upper.a.price and lower.b.price > lower.a.price
        assert of(pole_and_pause(CONVERGING), "bullFlag") == []

    def test_a_parallel_pause_stays_a_flag(self) -> None:
        s = pole_and_pause([(112.4, 107.0)] * 5)
        assert of(s, "bullPennant") == []
        assert len(of(s, "bullFlag")) == 1

    def test_bear_pennant_is_the_mirror(self) -> None:
        assert len(of(mirror(pole_and_pause(CONVERGING)), "bearPennant")) == 1


CUP: list[tuple[int, float]] = [
    (0, 100),
    (10, 120),
    (25, 104),
    (30, 102),
    (40, 103),
    (45, 104),
    (60, 120),
    (66, 115),
    (72, 124),
]
V_CUP: list[tuple[int, float]] = [(0, 100), (10, 120), (35, 102), (60, 120), (66, 115), (72, 124)]


class TestCupWithHandle:
    def test_confirms_above_the_right_rim(self) -> None:
        hits = of(path(CUP), "cupWithHandle")
        assert len(hits) == 1
        h = hits[0]
        labels = {p.label: p.price for p in h.points}
        assert h.entry > labels["Right rim"]
        assert labels["Handle low"] > (labels["Cup low"] + labels["Right rim"]) / 2  # upper half
        assert h.target == pytest.approx(h.entry + labels["Right rim"] - labels["Cup low"])

    def test_a_v_is_not_a_cup(self, monkeypatch: pytest.MonkeyPatch) -> None:
        assert of(path(V_CUP), "cupWithHandle") == []
        monkeypatch.setattr(chart_patterns, "CUP_U_SHARE", 0.0)  # the U rule is what rejects it
        assert len(of(path(V_CUP), "cupWithHandle")) == 1

    def test_needs_a_handle(self) -> None:
        no_handle: list[tuple[int, float]] = [*CUP[:7], (66, 124), (70, 125)]
        assert of(path(no_handle), "cupWithHandle") == []

    def test_a_handle_in_the_lower_half_fails(self) -> None:
        deep: list[tuple[int, float]] = [*CUP[:7], (66, 108), (74, 124)]
        assert of(path(deep), "cupWithHandle") == []

    def test_inverted_cup_is_the_mirror(self) -> None:
        assert len(of(mirror(path(CUP)), "invertedCupWithHandle")) == 1
