"""Candlestick context rules on top of TA-Lib's shapes."""

from __future__ import annotations

import pytest

from tcs.analysis.candlesticks import detect_candlesticks

from .helpers import candles


def decline(
    n: int = 20, start: float = 120.0, step: float = 1.0
) -> list[tuple[float, float, float, float]]:
    rows: list[tuple[float, float, float, float]] = []
    p = start
    for _ in range(n):
        rows.append((p, p + 0.4, p - step - 0.4, p - step))
        p -= step
    return rows


def rise(
    n: int = 20, start: float = 80.0, step: float = 1.0
) -> list[tuple[float, float, float, float]]:
    rows: list[tuple[float, float, float, float]] = []
    p = start
    for _ in range(n):
        rows.append((p, p + step + 0.4, p - 0.4, p + step))
        p += step
    return rows


def found(rows: list[tuple[float, float, float, float]]) -> set[tuple[str, int]]:
    return {(h.pattern, h.index) for h in detect_candlesticks(candles(rows))}


def test_bullish_engulfing_after_a_decline() -> None:
    rows = decline()
    p = rows[-1][3]
    rows += [(p, p + 0.3, p - 1.5, p - 1.2), (p - 1.6, p + 1.2, p - 1.8, p + 0.9)]
    assert ("bullishEngulfing", len(rows) - 1) in found(rows)


def test_engulfing_without_a_prior_decline_is_ignored() -> None:
    rows = rise()
    p = rows[-1][3]
    rows += [(p, p + 0.3, p - 1.5, p - 1.2), (p - 1.6, p + 1.2, p - 1.8, p + 0.9)]
    assert not any(k == "bullishEngulfing" for k, _ in found(rows))


def test_dust_candles_do_not_count() -> None:
    rows = decline(step=1.0)
    p = rows[-1][3]
    rows += [(p, p + 0.02, p - 0.06, p - 0.05), (p - 0.06, p + 0.04, p - 0.07, p + 0.03)]
    assert not any(k == "bullishEngulfing" for k, _ in found(rows))


def test_hammer_after_a_decline_and_hanging_man_after_a_rise() -> None:
    down = decline()
    p = down[-1][3]
    down.append((p - 0.2, p + 0.1, p - 3.2, p))
    assert ("hammer", len(down) - 1) in found(down)
    up = rise()
    q = up[-1][3]
    up.append((q + 0.2, q + 0.5, q - 2.8, q + 0.4))
    assert ("hangingMan", len(up) - 1) in found(up)


def test_plan_has_stop_beyond_the_pattern_and_1_5r_target() -> None:
    rows = decline()
    p = rows[-1][3]
    rows += [(p, p + 0.3, p - 1.5, p - 1.2), (p - 1.6, p + 1.2, p - 1.8, p + 0.9)]
    h = next(h for h in detect_candlesticks(candles(rows)) if h.pattern == "bullishEngulfing")
    assert h.stop < h.extreme
    assert (h.target - h.entry) / (h.entry - h.stop) == pytest.approx(1.5)
