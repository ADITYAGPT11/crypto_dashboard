"""Locations are matched by time and must exist before the pattern began."""

from __future__ import annotations

from tcs.analysis.location import locate
from tcs.analysis.types import OrderBlock, PatternHit, Zone

from .helpers import candles

S = candles([(100, 101, 99, 100)] * 40)  # 1h candles, open_time = i hours
D = candles([(100, 101, 99, 100)] * 10, tf="4h")


def long_hit(start: int, index: int, low: float) -> PatternHit:
    return PatternHit("doubleBottom", "long", index, 100, low - 1, 110, start, low)


def zone(formed: int, end: int | None = None, kind: str = "demand") -> Zone:
    return Zone(
        "demand" if kind == "demand" else "supply", 95, 97, formed - 1, formed, end, 0, 0, 2.0
    )


def block(formed: int) -> OrderBlock:
    return OrderBlock("bullish", 95.5, 96.5, formed - 1, formed, None, None, 99)


def test_zone_known_before_the_pattern_counts() -> None:
    assert locate(long_hit(10, 20, 96), S, 1.0, S, [zone(5)], []) == "zone"


def test_zone_formed_during_the_pattern_does_not_count() -> None:
    assert locate(long_hit(10, 20, 96), S, 1.0, S, [zone(12)], []) == "openSpace"


def test_zone_broken_before_confirmation_does_not_count() -> None:
    assert locate(long_hit(10, 20, 96), S, 1.0, S, [zone(5, end=15)], []) == "openSpace"
    assert locate(long_hit(10, 20, 96), S, 1.0, S, [zone(5, end=25)], []) == "zone"


def test_confluence_and_order_block_only() -> None:
    assert locate(long_hit(10, 20, 96), S, 1.0, S, [zone(5)], [block(6)]) == "confluence"
    assert locate(long_hit(10, 20, 96), S, 1.0, S, [], [block(6)]) == "orderBlock"


def test_direction_must_match() -> None:
    assert locate(long_hit(10, 20, 96), S, 1.0, S, [zone(5, kind="supply")], []) == "openSpace"


def test_higher_timeframe_zone_known_by_its_close_time() -> None:
    # 4h candle 2 opens at 8h and closes at 12h; a pattern starting at 1h-candle 12 may use it.
    assert locate(long_hit(12, 20, 96), S, 1.0, D, [zone(2)], []) == "zone"
    # Starting at 1h-candle 11 (11:00) is before that 4h candle closed.
    assert locate(long_hit(11, 20, 96), S, 1.0, D, [zone(2)], []) == "openSpace"
