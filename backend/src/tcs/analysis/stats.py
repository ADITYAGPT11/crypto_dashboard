"""Setup statistics: sample size, win rate with its Wilson 95% range, break-even, verdict.

Expectancy, break-even and the verdict are measured after trading costs (``costs.py``); the
gross figures are kept alongside so the effect of costs stays visible.
"""

from __future__ import annotations

import math
import statistics
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal

#: Fewer resolved cases than this cannot support a verdict.
MIN_SAMPLE = 30

Verdict = Literal["edge", "noEdge", "tooFew"]


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    """Wilson score interval; (0, 1) when nothing is known."""
    if n <= 0:
        return (0.0, 1.0)
    p = k / n
    z2 = z * z
    denom = 1 + z2 / n
    centre = p + z2 / (2 * n)
    margin = z * math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))
    return (max(0.0, (centre - margin) / denom), min(1.0, (centre + margin) / denom))


@dataclass(frozen=True, slots=True)
class Resolved:
    """One finished case: what the statistics need from an occurrence."""

    win: bool
    move_pct: float
    r: float
    bars: int
    #: Fees, slippage and funding of this case in R (``costs.trade_cost``).
    cost_r: float = 0.0


@dataclass(frozen=True, slots=True)
class Summary:
    n: int
    wins: int
    losses: int
    expired: int
    win_rate: float
    ci_low: float
    ci_high: float
    #: Win rate needed to break even given the average win size in R (losses are -1R), gross.
    break_even: float
    avg_win_pct: float
    avg_loss_pct: float
    #: Mean result per resolved case in R, before costs.
    expectancy_r: float
    median_bars: float
    #: From the win rate's Wilson low against the break-even after costs.
    verdict: Verdict
    #: Mean result per resolved case in R after fees, slippage and funding.
    expectancy_net_r: float = 0.0
    #: Win rate needed to break even after costs (1.0 when even wins lose after costs).
    break_even_net: float = 0.5
    #: Mean cost per case in R (fees + slippage + funding).
    avg_cost_r: float = 0.0


def _mean(xs: Sequence[float]) -> float:
    return statistics.fmean(xs) if xs else 0.0


def verdict_for(n: int, ci_low: float, break_even: float) -> Verdict:
    if n < MIN_SAMPLE:
        return "tooFew"
    return "edge" if ci_low > break_even else "noEdge"


def summarize(cases: Sequence[Resolved], expired: int = 0) -> Summary:
    wins = [c for c in cases if c.win]
    losses = [c for c in cases if not c.win]
    n, k = len(cases), len(wins)
    lo, hi = wilson(k, n)
    avg_win_r = _mean([c.r for c in wins])
    break_even = 1 / (1 + avg_win_r) if avg_win_r > 0 else 0.5
    # After costs a win pays r - cost and a loss costs 1 + cost: break even where
    # p * W = (1 - p) * L.
    net_win = _mean([c.r - c.cost_r for c in wins])
    net_loss = _mean([1 + c.cost_r for c in losses]) if losses else 1.0
    break_even_net = net_loss / (net_win + net_loss) if net_win > 0 else 1.0
    if not cases:
        break_even_net = break_even
    return Summary(
        n=n,
        wins=k,
        losses=len(losses),
        expired=expired,
        win_rate=k / n if n else 0.0,
        ci_low=lo,
        ci_high=hi,
        break_even=break_even,
        avg_win_pct=_mean([c.move_pct for c in wins]),
        avg_loss_pct=_mean([c.move_pct for c in losses]),
        expectancy_r=_mean([c.r for c in cases]),
        median_bars=statistics.median([c.bars for c in cases]) if cases else 0.0,
        verdict=verdict_for(n, lo, break_even_net),
        expectancy_net_r=_mean([c.r - c.cost_r for c in cases]),
        break_even_net=break_even_net,
        avg_cost_r=_mean([c.cost_r for c in cases]),
    )


@dataclass(frozen=True, slots=True)
class TrailSummary:
    """Setups exited with the trailing take-profit (``outcomes.evaluate_trailing``).

    Every closed case counts, including those closed at the market after the holding limit, so
    the expectancy is the mean result per trade. Wins, the expectancy's 95% range (normal
    approximation) and the verdict (does that range clear 0 R?) are after costs; the gross
    expectancy is kept alongside.
    """

    n: int
    #: Cases that closed in profit after costs.
    wins: int
    win_rate: float
    ci_low: float
    ci_high: float
    #: Mean result per trade in R, before costs.
    expectancy_r: float
    #: Mean result per trade in R after fees, slippage and funding.
    expectancy_net_r: float
    #: 95% range of the net expectancy; None with fewer than two cases.
    exp_low: float | None
    exp_high: float | None
    avg_win_r: float
    avg_cost_r: float
    median_bars: float
    verdict: Verdict


def summarize_trailing(cases: Sequence[tuple[float, int, float]]) -> TrailSummary:
    """``cases`` = (R, candles held, cost in R) of each closed trade."""
    rs = [r for r, _, _ in cases]
    net = [r - c for r, _, c in cases]
    n = len(net)
    k = sum(1 for x in net if x > 0)
    lo, hi = wilson(k, n)
    mean = _mean(net)
    half = 1.96 * statistics.stdev(net) / math.sqrt(n) if n > 1 else None
    verdict: Verdict = (
        "tooFew" if n < MIN_SAMPLE or half is None else "edge" if mean - half > 0 else "noEdge"
    )
    return TrailSummary(
        n=n,
        wins=k,
        win_rate=k / n if n else 0.0,
        ci_low=lo,
        ci_high=hi,
        expectancy_r=_mean(rs),
        expectancy_net_r=mean,
        exp_low=None if half is None else mean - half,
        exp_high=None if half is None else mean + half,
        avg_win_r=_mean([x for x in net if x > 0]),
        avg_cost_r=_mean([c for _, _, c in cases]),
        median_bars=statistics.median([b for _, b, _ in cases]) if cases else 0.0,
        verdict=verdict,
    )
