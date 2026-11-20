"""Outcome resolution, statistics and the verdict."""

from __future__ import annotations

import numpy as np
import pytest

from tcs.analysis.engine import detect_patterns
from tcs.analysis.indicators import atr
from tcs.analysis.outcomes import evaluate, evaluate_trailing
from tcs.analysis.stats import MIN_SAMPLE, Resolved, summarize, summarize_trailing, wilson
from tcs.analysis.types import PatternHit

from .helpers import candles, real_eth_4h


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


# Trailing take-profit -----------------------------------------------------------------------


def test_trailing_tp_follows_the_best_price_after_the_target() -> None:
    s = candles(
        [
            (100, 100, 100, 100),
            (100, 105, 99, 104),
            (104, 112, 104, 111),  # touches the target 110: trailing starts at this close
            (111, 115, 111.5, 114),  # stop was 112 - 1 = 111: holds; new best 115 → stop 114
            (114, 114.5, 113, 113.5),  # trades through 114: out at 114
        ]
    )
    t = evaluate_trailing(s, hit("long", 100, 95, 110), np.full(len(s), 2.0))
    assert (t.result, t.exit_index, t.activated) == ("win", 4, 2)
    assert t.exit_price == pytest.approx(114)
    assert t.r == pytest.approx(14 / 5)  # the fixed target would have paid 2R
    assert t.stops == ((1, 95), (3, 111), (4, 114))


def test_trailing_short_mirrors_long_and_stop_first_before_target() -> None:
    s = candles(
        [(100, 100, 100, 100), (100, 101, 89, 90), (90, 89.8, 86, 87), (87, 88, 86.5, 87.5)]
    )
    t = evaluate_trailing(s, hit("short", 100, 105, 90), np.full(len(s), 2.0))
    assert (t.result, t.activated) == ("win", 1)
    assert t.exit_price == pytest.approx(87)  # best 86 + 0.5 x 2
    both = candles([(100, 100, 100, 100), (100, 111, 94, 100)])
    lost = evaluate_trailing(both, hit("long", 100, 95, 110), np.full(2, 2.0))
    assert (lost.result, lost.r) == ("loss", -1.0)


def test_trailing_open_and_expired_at_market() -> None:
    flat = candles([(100, 101, 99, 100)] * 5)
    a = np.full(5, 1.0)
    assert evaluate_trailing(flat, hit("long", 100, 90, 120), a).result == "open"
    t = evaluate_trailing(flat, hit("long", 100, 90, 120), a, max_bars=3)
    assert (t.result, t.exit_price, t.r) == ("expired", 100, 0.0)


def test_trailing_uses_no_candle_after_its_exit_and_only_tightens() -> None:
    s = real_eth_4h()
    a = atr(s)
    checked = 0
    for h in detect_patterns(s)[::7]:
        t = evaluate_trailing(s, h, a)
        if t.exit_index is None:
            continue
        cut = evaluate_trailing(s.head(t.exit_index + 1), h, a[: t.exit_index + 1])
        assert cut == t
        d = 1 if h.direction == "long" else -1
        assert all((b[1] - a_[1]) * d > 0 for a_, b in zip(t.stops, t.stops[1:], strict=False))
        checked += 1
    assert checked > 50


def test_trailing_summary_counts_every_closed_trade() -> None:
    t = summarize_trailing([(2.8, 4, 0.1), (-1.0, 2, 0.1), (0.4, 120, 0.5)] * 12)
    assert (t.n, t.wins) == (36, 12)  # the +0.4 R trades lose after their 0.5 R of costs
    assert t.expectancy_r == pytest.approx((2.8 - 1.0 + 0.4) / 3)
    assert t.expectancy_net_r == pytest.approx((2.7 - 1.1 - 0.1) / 3)
    assert t.exp_low is not None and t.exp_low < t.expectancy_net_r < (t.exp_high or 0)
    assert t.avg_cost_r == pytest.approx(0.7 / 3)
    assert summarize_trailing([(1.0, 3, 0.0)]).verdict == "tooFew"
