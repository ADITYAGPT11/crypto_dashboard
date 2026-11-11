"""Demand/supply zones, structure breaks, order blocks and fair value gaps."""

from __future__ import annotations

from tcs.analysis.smc import detect_fvgs, detect_structure
from tcs.analysis.zones import detect_zones

from .helpers import candles, path

Row = tuple[float, float, float, float]


def chop(n: int, p: float = 100.0) -> list[Row]:
    """Alternating strong-bodied candles (not basing candles): ATR about 1."""
    return [
        (p - 0.4, p + 0.5, p - 0.5, p + 0.4) if i % 2 else (p + 0.4, p + 0.5, p - 0.5, p - 0.4)
        for i in range(n)
    ]


def test_demand_zone_from_base_and_departure_then_tested_held_and_broken() -> None:
    rows = chop(20)
    rows += [(100, 100.5, 99.4, 100.1), (100.1, 100.6, 99.5, 99.9)]  # base: 2 small bodies
    rows += [(99.9, 104.5, 99.8, 104.2)]  # departure: 4.7 range, strong body, beyond the base
    rows += [(104.2, 104.6, 103.5, 104.0)] * 3
    rows += [(104.0, 104.1, 99.9, 100.8), (100.8, 102.6, 100.6, 102.4)]  # test, held
    rows += [(102.4, 102.5, 98.0, 98.2)]  # closes below the distal edge: broken
    zones = [z for z in detect_zones(candles(rows)) if z.kind == "demand" and z.formed == 22]
    assert len(zones) == 1
    z = zones[0]
    assert z.start == 20
    assert z.low == 99.4  # lowest low of base and departure
    assert z.high == 100.1  # highest body top of the base
    # Two tests: the one that held, and the breaking candle (it trades in before closing below).
    assert (z.tests, z.held, z.end) == (2, 1, len(rows) - 1)
    assert z.departure_atr > 2


def test_no_base_no_zone() -> None:
    rows = chop(20)
    rows += [(100, 102, 99.9, 101.9)]  # strong candle, not a base
    rows += [(101.9, 106.5, 101.8, 106.3)]
    assert [z for z in detect_zones(candles(rows)) if z.formed == 21] == []


def test_supply_zone_mirrors_demand() -> None:
    rows = chop(20)
    rows += [(100, 100.6, 99.5, 99.9), (99.9, 100.5, 99.4, 100.1)]
    rows += [(100.1, 100.2, 95.5, 95.8)]
    zones = [z for z in detect_zones(candles(rows)) if z.formed == 22]
    assert [z.kind for z in zones] == ["supply"]
    assert zones[0].high == 100.6


def test_bullish_break_of_structure_and_its_order_block() -> None:
    # Swing high at 105, pullback with a final down candle, then a close above 105.
    s = path([(0, 100), (10, 105), (18, 101), (26, 108), (32, 107)], wick=0.3)
    breaks, blocks = detect_structure(s)
    up = [b for b in breaks if b.direction == "up" and b.level == s.high[10]]
    assert len(up) == 1
    brk = up[0]
    assert s.close[brk.index] > brk.level and s.close[brk.index - 1] <= brk.level
    ob = next(b for b in blocks if b.formed == brk.index)
    assert ob.kind == "bullish"
    assert s.close[ob.index] < s.open[ob.index]  # the last down candle
    assert 10 < ob.index <= 18


def test_choch_is_the_first_break_against_the_trend() -> None:
    s = path(
        [(0, 100), (10, 110), (16, 106), (24, 114), (30, 109), (36, 112), (44, 100), (50, 101)]
    )
    kinds = [(b.kind, b.direction) for b in detect_structure(s)[0]]
    assert ("choch", "down") in kinds
    first_down = next(i for i, k in enumerate(kinds) if k[1] == "down")
    assert kinds[first_down][0] == "choch"


def test_fair_value_gap_and_fill() -> None:
    rows = chop(20)
    rows += [(100, 100.5, 99.5, 100.4), (100.4, 104, 100.3, 103.8), (103.8, 104.5, 101.5, 104.2)]
    rows += [(104.2, 104.3, 100.2, 100.4)]  # trades through the whole gap
    gaps = [g for g in detect_fvgs(candles(rows)) if g.index == 21]
    assert len(gaps) == 1
    g = gaps[0]
    assert (g.kind, g.low, g.high, g.formed, g.filled) == ("bullish", 100.5, 101.5, 22, 23)
