"""Ingredients: hand-checked signals, no look-ahead, non-overlapping moves, the verdict."""

from __future__ import annotations

import itertools

import numpy as np
import pytest

from tcs.analysis.ingredient_stats import (
    ROUND_TRIP,
    Move,
    MoveSummary,
    forward_moves,
    summarize_moves,
    verdict,
    z_adjusted,
)
from tcs.analysis.ingredients import INGREDIENTS, signals

from .helpers import candles, random_walk, real_eth_4h


def test_every_ingredient_has_a_signal_array() -> None:
    s = random_walk(1, n=600, tf="4h")
    sig = signals(s)
    assert set(sig) == {i.id for i in INGREDIENTS}
    for v in sig.values():
        assert v.shape == (600,) and set(np.unique(v)) <= {-1, 0, 1}


@pytest.mark.parametrize("seed", [2, 3])
def test_no_look_ahead(seed: int) -> None:
    s = random_walk(seed, n=700, tf="4h")
    funding = [
        (int(s.open_time[0]) + k * 8 * 3_600_000, 0.0001 * ((k * 5) % 9 - 4)) for k in range(1200)
    ]
    full = signals(s, s, funding)
    for n in (350, 520, 699):
        cut = signals(s.head(n), s.head(n), funding)
        for k, v in cut.items():
            # Daily-level patterns are located against levels known by then: same rule, cut data.
            assert np.array_equal(v, full[k][:n]), k


def test_hand_checked_signals() -> None:
    # 30 flat candles at 100, then a close at 110 above every previous high: a breakout long.
    rows = [(100.0, 101.0, 99.0, 100.0)] * 30 + [(100.0, 111.0, 100.0, 110.0)]
    s = candles(rows, tf="4h")
    sig = signals(s)
    assert sig["breakout_20"][30] == 1 and sig["breakout_20"][29] == 0
    assert sig["momentum_1d"][30] == 1  # up over the last 6 candles
    assert sig["always_long"].all()


def test_liquidity_sweep_needs_a_reclaim() -> None:
    # A swing low at 95 (candle 5), then a candle wicking to 94 and closing at 99: a sweep long.
    rows = [(100, 101, 99, 100)] * 5 + [(99, 99.5, 95, 98)] + [(98, 100, 97, 99)] * 4
    rows += [(99, 100, 94, 99)] + [(99, 100, 98, 99)] * 3
    s = candles([tuple(map(float, r)) for r in rows], tf="4h")  # type: ignore[misc]
    sig = signals(s)["liquidity_sweep"]
    assert sig[10] == 1
    assert sig[11:].tolist() == [0, 0, 0]  # the same swing is swept once


def test_forward_moves_do_not_overlap_and_are_in_atr() -> None:
    s = real_eth_4h().tail(400)
    always = np.ones(len(s), dtype=np.int8)
    moves = forward_moves(s, always, 6)
    assert all(b.t - a.t >= 6 for a, b in itertools.pairwise(moves))
    from tcs.analysis.indicators import atr

    a = atr(s)
    m = moves[0]
    assert m.atr_move == pytest.approx((s.close[m.t + 6] - s.close[m.t]) / a[m.t])
    assert m.cost_atr == pytest.approx(ROUND_TRIP * s.close[m.t] / a[m.t])
    short = forward_moves(s, -always, 6)
    assert [x.atr_move for x in short] == pytest.approx([-x.atr_move for x in moves])


def test_adjusted_ranges_are_wider() -> None:
    xs = [Move(i, i, 0.1 + 0.5 * ((i * 7) % 5 - 2), 0.0, 0.05) for i in range(200)]
    m = summarize_moves(xs, tests=39)
    assert m.low_adj < m.low < m.mean_atr < m.high < m.high_adj
    assert z_adjusted(39) > 3 > z_adjusted(1) > 1.9
    assert m.net_atr == pytest.approx(m.mean_atr - 0.05)


def summary(
    mean: float, lo_adj: float, hi_adj: float, n: int = 500, net_lo: float = -1
) -> MoveSummary:
    return MoveSummary(n, mean, lo_adj, hi_adj, lo_adj, hi_adj, 0, 0.5, 0.07, mean - 0.07, net_lo)


def test_verdict() -> None:
    good = summary(0.05, 0.01, 0.09)
    assert verdict(good, summary(0.03, -1, 1), summary(0.02, -1, 1)) == "edgeBeforeCosts"
    assert verdict(summary(0.2, 0.1, 0.3, net_lo=0.02), good, good) == "edgeAfterCosts"
    assert verdict(good, summary(-0.01, -1, 1), good) == "inconsistent"
    assert (
        verdict(summary(-0.2, -0.3, -0.1), summary(-0.1, -1, 1), summary(-0.1, -1, 1)) == "reversed"
    )
    assert verdict(summary(0.01, -0.02, 0.04), good, good) == "none"
    assert verdict(good, summary(0.1, 0, 1, n=10), good) == "tooFew"
