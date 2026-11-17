"""Order-flow context (``analysis/flow.py``): each clause, no look-ahead, scale, mirror twin."""

from __future__ import annotations

import math

import numpy as np
import pytest

from tcs.analysis.flow import (
    DELTA_RATIO,
    DIV_BARS,
    FLOW_BARS,
    UNKNOWN,
    FlowContext,
    contexts,
    flow_at,
)
from tcs.analysis.types import Direction, PatternHit
from tcs.common.series import Series, mirror

from .helpers import random_walk, real_eth_4h


def hit(i: int, direction: Direction = "long") -> PatternHit:
    return PatternHit("hammer", direction, i, 1.0, 0.5, 2.0, max(0, i - 1), 0.5)


def flat(n: int, buy_share: list[float] | float, lows: list[float] | None = None) -> Series:
    vol = np.full(n, 100.0)
    share = np.asarray(buy_share if isinstance(buy_share, list) else [buy_share] * n)
    low = np.asarray(lows if lows is not None else [9.0] * n, dtype=np.float64)
    return Series(
        "TEST-USDT",
        "1h",
        np.arange(n, dtype=np.int64) * 3_600_000,
        np.full(n, 10.0),
        np.maximum(11.0, low + 2),
        low,
        np.full(n, 10.0),
        vol,
        vol * share,
    )


def test_delta_confirms_against_and_neutral() -> None:
    edge = 0.5 + DELTA_RATIO / 2  # buy share giving exactly the threshold ratio
    assert flow_at(flat(5, edge), hit(4)).flow == "confirms"
    assert flow_at(flat(5, 1 - edge), hit(4)).flow == "against"
    assert flow_at(flat(5, 0.5), hit(4)).flow == "neutral"
    f = flow_at(flat(5, 0.7), hit(4))
    assert f.delta_ratio == pytest.approx(0.4)


def test_delta_uses_only_the_last_bars_up_to_the_hit() -> None:
    share = [0.0] * 10 + [1.0] * FLOW_BARS + [0.0] * 5  # buying only on the 3 bars before 12
    assert flow_at(flat(18, share), hit(12)).flow == "confirms"
    assert flow_at(flat(18, share), hit(9)).flow == "against"


def test_short_setups_read_delta_the_other_way() -> None:
    assert flow_at(flat(5, 0.8), hit(4, "short")).flow == "against"
    assert flow_at(flat(5, 0.2), hit(4, "short")).flow == "confirms"


def test_unknown_without_taker_volume_or_history() -> None:
    s = flat(30, 0.6)
    no_taker = Series(s.symbol, s.tf, s.open_time, s.open, s.high, s.low, s.close, s.volume, None)
    assert flow_at(no_taker, hit(20)) == UNKNOWN
    assert flow_at(s, hit(FLOW_BARS - 2)) == UNKNOWN
    gap = flat(30, [0.6] * 18 + [math.nan] + [0.6] * 11)
    assert flow_at(gap, hit(29)).flow == "confirms"  # nan outside the delta window
    assert flow_at(gap, hit(29)).divergence is None  # but inside the divergence window
    assert flow_at(gap, hit(19)) == UNKNOWN


def test_bullish_cvd_divergence() -> None:
    n = 2 * DIV_BARS
    lows = [9.0] * DIV_BARS + [8.0] * DIV_BARS  # lower low in the second window
    # Heavy selling first, mild selling after: CVD keeps falling but its low is ... lower.
    falling = flat(n, [0.2] * DIV_BARS + [0.45] * DIV_BARS, lows)
    assert flow_at(falling, hit(n - 1)).divergence is False
    # Selling first, then buying: price makes a lower low while CVD rises -> divergence.
    diverging = flat(n, [0.2] * DIV_BARS + [0.7] * DIV_BARS, lows)
    assert flow_at(diverging, hit(n - 1)).divergence is True
    # No lower low: no divergence, whatever CVD does.
    no_ll = flat(n, [0.2] * DIV_BARS + [0.7] * DIV_BARS)
    assert flow_at(no_ll, hit(n - 1)).divergence is False
    assert flow_at(diverging, hit(n - 2)).divergence is None  # not enough history


SERIES = {"walk1": random_walk(1), "walk2": random_walk(2), "eth4h": real_eth_4h().tail(600)}


@pytest.mark.parametrize("s", SERIES.values(), ids=SERIES.keys())
def test_no_look_ahead_and_scale_invariant(s: Series) -> None:
    for i in range(0, len(s), 37):
        for d in ("long", "short"):
            h = hit(i, d)
            full = flow_at(s, h)
            assert flow_at(s.head(i + 1), h) == full
            assert flow_at(s.scaled(1000.0), h) == full


@pytest.mark.parametrize("s", SERIES.values(), ids=SERIES.keys())
def test_short_is_the_long_rule_on_the_mirrored_series(s: Series) -> None:
    m = mirror(s)
    for i in range(0, len(s), 29):
        long_ = flow_at(s, hit(i, "long"))
        short = flow_at(m, hit(i, "short"))
        assert long_.flow == short.flow and long_.divergence == short.divergence
        if long_.delta_ratio is not None:
            assert short.delta_ratio == pytest.approx(long_.delta_ratio)


def test_real_candles_give_every_bucket() -> None:
    s = real_eth_4h()
    seen = {c for i in range(30, len(s), 3) for c in contexts(flow_at(s, hit(i)))}
    assert seen == {"delta:confirms", "delta:against", "delta:neutral", "cvdDiv:yes", "cvdDiv:no"}


def test_contexts_skip_what_is_unknown() -> None:
    assert contexts(UNKNOWN) == []
    assert contexts(FlowContext(0.1, "confirms", None)) == ["delta:confirms"]
    assert contexts(FlowContext(0.0, "neutral", True)) == ["delta:neutral", "cvdDiv:yes"]
