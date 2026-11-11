"""Outcome resolution, statistics and the verdict."""

from __future__ import annotations

import pytest

from tcs.analysis.outcomes import evaluate
from tcs.analysis.stats import MIN_SAMPLE, Resolved, summarize, wilson
from tcs.analysis.types import PatternHit

from .helpers import candles


def hit(direction: str, entry: float, stop: float, target: float, index: int = 0) -> PatternHit:
    return PatternHit(
        "test", "long" if direction == "long" else "short", index, entry, stop, target, 0, stop
    )


def test_long_win_loss_and_conservative_tie() -> None:
    s = candles([(100, 100, 100, 100), (100, 104, 99, 103), (103, 112, 102, 111)])
    assert evaluate(s, hit("long", 100, 95, 110)).result == "win"
    assert evaluate(s, hit("long", 100, 99.5, 110)).result == "loss"
    both = candles([(100, 100, 100, 100), (100, 111, 94, 100)])
    assert evaluate(both, hit("long", 100, 95, 110)).result == "loss"  # stop assumed first


def test_short_is_mirrored() -> None:
    s = candles([(100, 100, 100, 100), (100, 101, 89, 90)])
    o = evaluate(s, hit("short", 100, 105, 90))
    assert (o.result, o.r) == ("win", pytest.approx(2.0))
    assert o.move_pct == pytest.approx(10.0)


def test_open_and_expired() -> None:
    flat = candles([(100, 101, 99, 100)] * 5)
    assert evaluate(flat, hit("long", 100, 90, 120)).result == "open"
    assert evaluate(flat, hit("long", 100, 90, 120), max_bars=3).result == "expired"


def test_wilson_matches_reference_values() -> None:
    lo, hi = wilson(20, 40)
    assert lo == pytest.approx(0.3520, abs=1e-4)
    assert hi == pytest.approx(0.6480, abs=1e-4)
    assert wilson(0, 0) == (0.0, 1.0)


def test_break_even_and_verdict() -> None:
    wins = [Resolved(True, 4.0, 2.0, 5)] * 25
    losses = [Resolved(False, -2.0, -1.0, 3)] * 15
    s = summarize([*wins, *losses])
    assert s.n == 40
    assert s.break_even == pytest.approx(1 / 3)
    assert s.expectancy_r == pytest.approx((25 * 2 - 15) / 40)
    assert s.verdict == "edge"  # Wilson low 0.47 > break-even 0.33
    few = summarize([*wins[: MIN_SAMPLE // 2], *losses[:5]])
    assert few.verdict == "tooFew"
