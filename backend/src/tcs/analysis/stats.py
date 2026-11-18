"""Setup statistics: sample size, win rate with its Wilson 95% range, break-even, verdict."""

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


@dataclass(frozen=True, slots=True)
class Summary:
    n: int
    wins: int
    losses: int
    expired: int
    win_rate: float
    ci_low: float
    ci_high: float
    #: Win rate needed to break even given the average win size in R (losses are -1R).
    break_even: float
    avg_win_pct: float
    avg_loss_pct: float
    #: Mean result per resolved case in R, before fees.
    expectancy_r: float
    median_bars: float
    verdict: Verdict


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
        verdict=verdict_for(n, lo, break_even),
    )


@dataclass(frozen=True, slots=True)
class TrailSummary:
    """Setups exited with the trailing take-profit (``outcomes.evaluate_trailing``).

    Every closed case counts, including those closed at the market after the holding limit, so
    the expectancy is the mean result per trade. There is no fixed reward, so the verdict asks
    whether the 95% range of the expectancy (normal approximation) clears zero. Before fees.
    """

    n: int
    wins: int
    win_rate: float
    ci_low: float
    ci_high: float
    expectancy_r: float
    #: 95% range of the expectancy; None with fewer than two cases.
    exp_low: float | None
    exp_high: float | None
    avg_win_r: float
    median_bars: float
    verdict: Verdict


def summarize_trailing(cases: Sequence[tuple[float, int]]) -> TrailSummary:
    """``cases`` = (R, candles held) of each closed trade."""
    rs = [r for r, _ in cases]
    n = len(rs)
    k = sum(1 for r in rs if r > 0)
    lo, hi = wilson(k, n)
    mean = _mean(rs)
    half = 1.96 * statistics.stdev(rs) / math.sqrt(n) if n > 1 else None
    verdict: Verdict = (
        "tooFew" if n < MIN_SAMPLE or half is None else "edge" if mean - half > 0 else "noEdge"
    )
    return TrailSummary(
        n=n,
        wins=k,
        win_rate=k / n if n else 0.0,
        ci_low=lo,
        ci_high=hi,
        expectancy_r=mean,
        exp_low=None if half is None else mean - half,
        exp_high=None if half is None else mean + half,
        avg_win_r=_mean([r for r in rs if r > 0]),
        median_bars=statistics.median([b for _, b in cases]) if cases else 0.0,
        verdict=verdict,
    )
