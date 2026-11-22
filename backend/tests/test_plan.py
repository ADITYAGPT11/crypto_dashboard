"""Trade plan per timeframe (``analysis/plan.py``): the 1h stop buffer and the cost filter."""

from __future__ import annotations

import numpy as np
import pytest

from tcs.analysis.plan import MAX_COST_R, ROUND_TRIP_PCT, apply_plan, cost_r
from tcs.analysis.types import PatternHit
from tcs.common.series import Series
from tcs.common.timeframes import Timeframe

from .helpers import candles


def hit(pattern: str, direction: str, entry: float, stop: float) -> PatternHit:
    d = "long" if direction == "long" else "short"
    return PatternHit(pattern, d, 1, entry, stop, entry + (entry - stop) * 2, 0, stop)


def series(tf: Timeframe) -> Series:
    return candles([(100.0, 101.0, 99.0, 100.0)] * 3, tf=tf)


def test_1h_stops_sit_half_an_atr_beyond_the_invalidation_price() -> None:
    a = np.full(3, 2.0)
    chart, candle = hit("doubleBottom", "long", 100, 90), hit("hammer", "long", 100, 90)
    out = apply_plan([chart, candle], series("1h"), a)
    assert out[0].stop == pytest.approx(90 - 0.3 * 2)  # detector used 0.2 ATR: 0.3 more
    assert out[1].stop == pytest.approx(90 - 0.4 * 2)  # candlesticks used 0.1 ATR: 0.4 more
    short = apply_plan([hit("bearFlag", "short", 100, 110)], series("1h"), a)[0]
    assert short.stop == pytest.approx(110 + 0.3 * 2)


def test_other_timeframes_keep_the_detectors_stop() -> None:
    h = hit("doubleBottom", "long", 100, 90)
    assert apply_plan([h], series("4h"), np.full(3, 2.0))[0].stop == 90
    assert apply_plan([h], series("1d"), np.full(3, 2.0))[0].stop == 90


def test_setups_whose_costs_eat_more_than_a_tenth_of_the_risk_are_skipped() -> None:
    min_risk_pct = ROUND_TRIP_PCT / MAX_COST_R  # 1.5% of price with the default costs
    tight = hit("doubleBottom", "long", 100, 100 - min_risk_pct * 0.9)
    wide = hit("doubleBottom", "long", 100, 100 - min_risk_pct * 1.1)
    assert cost_r(tight) > MAX_COST_R > cost_r(wide)
    assert apply_plan([tight, wide], series("4h"), np.full(3, 0.0)) == [wide]
