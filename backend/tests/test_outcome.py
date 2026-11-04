import numpy as np
import pytest

from tcs.research.patterns.outcome import BracketParams, atr, evaluate
from tests.synthetic import from_ohlc

P = BracketParams(stop_atr=1.0, target_atr=2.0, max_bars=3)


def flat(n: int) -> list[tuple[float, float, float, float]]:
    return [(100.0, 101.0, 99.0, 100.0)] * n


def test_long_win_loss_and_both_touched_counts_as_loss() -> None:
    win = from_ohlc([*flat(1), (100, 103, 99.5, 102)])
    assert evaluate(win, 0, 1, 1.0, P).result == "win"
    o = evaluate(win, 0, 1, 1.0, P)
    assert (o.entry, o.stop, o.target, o.r) == (100.0, 99.0, 102.0, 2.0)
    loss = from_ohlc([*flat(1), (100, 100.5, 98.9, 99)])
    assert evaluate(loss, 0, 1, 1.0, P).result == "loss"
    both = from_ohlc([*flat(1), (100, 102.5, 98.5, 100)])
    assert evaluate(both, 0, 1, 1.0, P).result == "loss"


def test_short_mirrors_long() -> None:
    c = from_ohlc([*flat(1), (100, 100.5, 97.5, 98)])
    o = evaluate(c, 0, -1, 1.0, P)
    assert (o.result, o.stop, o.target) == ("win", 101.0, 98.0)
    assert o.move_pct == pytest.approx(2.0)


def test_expired_vs_open() -> None:
    quiet = [(100.0, 100.5, 99.5, 100.0)] * 5
    assert evaluate(from_ohlc(quiet), 0, 1, 1.0, P).result == "expired"
    assert evaluate(from_ohlc(quiet), 3, 1, 1.0, P).result == "open"


def test_forward_returns_are_signed_and_missing_past_the_end() -> None:
    rows = [(100.0, 100.5, 99.5, 100.0 + i) for i in range(8)]
    o = evaluate(from_ohlc(rows), 0, -1, 50.0, P)
    assert o.forward_pct[5] == pytest.approx(-5.0)
    assert o.forward_pct[10] is None


def test_atr_is_wilder_and_nan_before_period() -> None:
    c = from_ohlc([(100.0, 102.0, 98.0, 100.0)] * 20)
    a = atr(c, period=14)
    assert np.isnan(a[13]) and a[14] == pytest.approx(4.0) and a[19] == pytest.approx(4.0)
