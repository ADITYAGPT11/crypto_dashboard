"""The after-pattern ride (Supertrend from entry) and its comparison with random candles."""

from __future__ import annotations

import numpy as np
import pytest

from tcs.analysis.engine import detect_patterns
from tcs.analysis.indicators import atr
from tcs.analysis.outcomes import RIDE_ATR, evaluate_ride, ride_baseline
from tcs.analysis.stats import MIN_SAMPLE, RideBase, ride_base, summarize_ride

from .helpers import candles, real_eth_4h

ROWS: list[tuple[float, float, float, float]] = [
    (100, 101, 99, 100),  # entry: hl2 100, band 100 - 3 x 2 = 94
    (100, 106, 100, 105),  # holds; band → 103 - 6 = 97
    (105, 110, 104, 109),  # holds; band → 107 - 6 = 101
    (109, 109.5, 100, 100.5),  # closes below 101: the ride ends here
    (100, 120, 100, 119),  # never seen
]


def test_ride_follows_the_supertrend_band_and_ends_on_the_flip_close() -> None:
    s = candles(ROWS)
    r = evaluate_ride(s, 0, "long", np.full(len(s), 2.0))
    assert (r.result, r.exit_index, r.bars) == ("closed", 3, 3)
    assert r.exit_price == pytest.approx(100.5)
    assert r.move_pct == pytest.approx(0.5)
    assert r.best_pct == pytest.approx(10.0)
    assert r.worst_pct == pytest.approx(0.0)
    assert r.band == ((1, 94.0), (2, 97.0), (3, 101.0))


def test_short_ride_is_the_long_ride_upside_down() -> None:
    s = candles(ROWS)
    # the same path reflected around 200 (entry stays at 100; highs and lows swap)
    flipped = candles([(200 - o, 200 - lo, 200 - hi, 200 - c) for o, hi, lo, c in ROWS])
    a = np.full(len(s), 2.0)
    long = evaluate_ride(s, 0, "long", a)
    short = evaluate_ride(flipped, 0, "short", a)
    assert (short.result, short.exit_index) == (long.result, long.exit_index)
    assert short.move_pct == pytest.approx(long.move_pct)
    assert short.best_pct == pytest.approx(long.best_pct)


def test_open_when_data_runs_out_and_closed_at_the_cap() -> None:
    rising = candles([(100 + i, 101.5 + i, 99.5 + i, 101 + i) for i in range(6)])
    a = np.full(6, 1.0)
    assert evaluate_ride(rising, 0, "long", a).result == "open"
    capped = evaluate_ride(rising, 0, "long", a, max_bars=4)
    assert (capped.result, capped.exit_index, capped.bars) == ("closed", 4, 4)
    assert capped.move_pct == pytest.approx(4 / 101 * 100)  # entry close 101, cap close 105


def test_ride_uses_no_candle_after_its_exit() -> None:
    s = real_eth_4h()
    a = atr(s, RIDE_ATR)
    checked = 0
    for h in detect_patterns(s)[::5]:
        r = evaluate_ride(s, h.index, h.direction, a)
        if r.exit_index is None or r.exit_index == h.index + 200:
            continue
        assert evaluate_ride(s.head(r.exit_index + 1), h.index, h.direction, a) == r
        d = 1 if h.direction == "long" else -1
        assert all((b[1] - a_[1]) * d > 0 for a_, b in zip(r.band, r.band[1:], strict=False))
        checked += 1
    assert checked > 50


def test_baseline_rides_from_evenly_spaced_candles() -> None:
    s = real_eth_4h()
    rides = ride_baseline(s, "long", atr(s, RIDE_ATR), samples=100)
    assert 50 < len(rides) <= 110
    assert all(r.result == "closed" for r in rides)
    b = ride_base([(r.move_pct, r.best_pct) for r in rides])
    assert b.n == len(rides) and 0 < b.favourable_rate < 1


def test_summary_compares_the_average_move_with_random_candles() -> None:
    cases = [(3.0, 5.0, -1.0, 10, 0.2), (-1.0, 1.0, -2.0, 4, 0.2)] * 20  # 40 rides
    base = RideBase(n=500, favourable_rate=0.35, avg_move_pct=-0.2, avg_best_pct=4.0)
    s = summarize_ride(cases, base)
    assert (s.n, s.favourable) == (40, 20)
    assert s.favourable_rate == pytest.approx(0.5)
    assert s.avg_move_pct == pytest.approx(1.0)
    assert s.avg_net_move_pct == pytest.approx(0.8)
    assert s.median_bars == pytest.approx(7)
    assert s.move_low is not None and s.move_low > base.avg_move_pct
    assert s.vs_random == "better"
    worse = summarize_ride(cases, RideBase(500, 0.5, 1.5, 6.0))
    assert worse.vs_random == "notBetter"
    assert summarize_ride(cases[: MIN_SAMPLE - 2], base).vs_random == "tooFew"
