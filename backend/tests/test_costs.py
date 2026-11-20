"""Trading costs in R and the after-cost statistics."""

from __future__ import annotations

import pytest

from tcs.analysis.costs import NO_FUNDING, CostModel, Funding, trade_cost
from tcs.analysis.stats import MIN_SAMPLE, Resolved, summarize
from tcs.analysis.types import PatternHit

H8 = 8 * 3_600_000


def hit(direction: str, entry: float, stop: float) -> PatternHit:
    target = entry * 1.1 if direction == "long" else entry * 0.9
    return PatternHit(
        "t", "long" if direction == "long" else "short", 0, entry, stop, target, 0, stop
    )


def test_fees_and_slippage_scale_with_the_stop_distance() -> None:
    model = CostModel(fee_pct=0.05, slippage_pct=0.025)
    assert model.round_trip_pct == pytest.approx(0.15)
    wide = trade_cost(model, NO_FUNDING, hit("long", 100, 95), 0, 0)  # 5% risk
    tight = trade_cost(model, NO_FUNDING, hit("long", 100, 99.5), 0, 0)  # 0.5% risk
    assert wide.fees_r == pytest.approx(0.03)
    assert tight.fees_r == pytest.approx(0.3)


def test_funding_paid_by_longs_received_by_shorts_between_entry_and_exit() -> None:
    f = Funding([(H8, 0.01), (2 * H8, 0.03), (3 * H8, -0.02)])
    assert f.paid_pct("long", 0, 2 * H8) == (pytest.approx(0.04), False)  # (start, end]
    assert f.paid_pct("long", H8, 2 * H8) == (pytest.approx(0.03), False)
    assert f.paid_pct("short", 0, 3 * H8) == (pytest.approx(-0.02), False)
    c = trade_cost(CostModel(0, 0), f, hit("long", 100, 98), 0, 2 * H8)  # 2% risk
    assert c.funding_r == pytest.approx(0.02)
    assert c.total_r == pytest.approx(0.02)


def test_funding_after_the_last_known_event_is_carried_forward_and_flagged() -> None:
    f = Funding([(H8, 0.01), (2 * H8, 0.01), (3 * H8, 0.02)])
    paid, estimated = f.paid_pct("long", 2 * H8 + 1, 6 * H8)  # 3 known + events at 4, 5, 6
    assert estimated and paid == pytest.approx(0.02 + 3 * 0.02)
    paid, estimated = f.paid_pct("long", 4 * H8 + 1, 6 * H8)  # only 5 and 6, both estimated
    assert estimated and paid == pytest.approx(2 * 0.02)
    assert f.paid_pct("long", 0, 3 * H8)[1] is False


def test_costs_lower_expectancy_and_raise_break_even_and_can_flip_the_verdict() -> None:
    # 60% wins at 1R: gross break-even 50%, a Wilson low above it with enough cases.
    wins = [Resolved(True, 1.0, 1.0, 3, cost_r=0.0)] * 300
    losses = [Resolved(False, -1.0, -1.0, 3, cost_r=0.0)] * 200
    gross = summarize([*wins, *losses])
    assert gross.verdict == "edge"
    assert gross.expectancy_net_r == pytest.approx(gross.expectancy_r) == pytest.approx(0.2)
    # 0.3 R of costs per trade: a win pays 0.7, a loss costs 1.3 → break-even 65%.
    w = [Resolved(True, 1.0, 1.0, 3, cost_r=0.3)] * 300
    lo = [Resolved(False, -1.0, -1.0, 3, cost_r=0.3)] * 200
    net = summarize([*w, *lo])
    assert net.expectancy_r == pytest.approx(0.2)  # gross unchanged
    assert net.expectancy_net_r == pytest.approx(-0.1)
    assert net.break_even_net == pytest.approx(0.65)
    assert net.avg_cost_r == pytest.approx(0.3)
    assert net.verdict == "noEdge"


def test_break_even_is_unreachable_when_wins_lose_after_costs() -> None:
    w = [Resolved(True, 0.1, 0.1, 1, cost_r=0.2)] * MIN_SAMPLE
    s = summarize([*w, Resolved(False, -1.0, -1.0, 1, cost_r=0.2)])
    assert s.break_even_net == 1.0
    assert s.verdict == "noEdge"
