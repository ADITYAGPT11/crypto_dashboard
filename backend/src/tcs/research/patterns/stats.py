"""Win rate with its uncertainty, break-even and verdict: the same rules as the browser
(src/utils/stats.ts, summarize() in src/utils/setupAnalysis.ts) so numbers mean the same."""

from __future__ import annotations

import math
from dataclasses import dataclass
from statistics import NormalDist, mean, median
from typing import Literal

from tcs.research.patterns.outcome import FORWARD_HORIZONS, Outcome

MIN_SAMPLE = 30  # below this the verdict is "too few"
Verdict = Literal["edge", "noEdge", "tooFew"]


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    """Wilson score interval for k successes out of n; (0, 1) when n is 0."""
    if n <= 0:
        return (0.0, 1.0)
    p = k / n
    z2 = z * z
    denom = 1 + z2 / n
    centre = p + z2 / (2 * n)
    margin = z * math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))
    return (max(0.0, (centre - margin) / denom), min(1.0, (centre + margin) / denom))


def adjusted_z(tests: int) -> float:
    """z for a 95% interval Bonferroni-corrected over `tests` patterns.

    Scanning ~100 patterns at 95% each makes a few look like an edge on pure noise (we saw
    2 of 146 on a random walk). The verdict uses this stricter bound; the shown range stays 95%.
    """
    return NormalDist().inv_cdf(1 - 0.025 / max(1, tests))


def verdict_for(n: int, ci_low: float, break_even: float) -> Verdict:
    if n < MIN_SAMPLE:
        return "tooFew"
    return "edge" if ci_low > break_even else "noEdge"


@dataclass(frozen=True)
class ForwardStats:
    horizon: int
    n: int
    mean_pct: float
    median_pct: float
    positive_rate: float


@dataclass(frozen=True)
class PatternStats:
    n: int  # resolved: wins + losses
    wins: int
    losses: int
    expired: int
    open: int
    win_rate: float
    ci_low: float
    ci_high: float
    ci_low_adjusted: float  # Wilson low end corrected for the number of patterns tested
    tests: int
    break_even: float
    avg_win_pct: float
    avg_loss_pct: float
    expectancy_r: float
    median_bars: float
    verdict: Verdict
    forward: tuple[ForwardStats, ...]


def _mean(xs: list[float]) -> float:
    return mean(xs) if xs else 0.0


def summarize(outcomes: list[Outcome], tests: int = 1) -> PatternStats:
    wins = [o for o in outcomes if o.result == "win"]
    losses = [o for o in outcomes if o.result == "loss"]
    resolved = wins + losses
    n = len(resolved)
    lo, hi = wilson(len(wins), n)
    lo_adj = wilson(len(wins), n, adjusted_z(tests))[0]
    avg_win_r = _mean([o.r for o in wins])
    # Break-even p* solves p·W = (1 - p)·1R.
    break_even = 1 / (1 + avg_win_r) if avg_win_r > 0 else 0.5
    forward: list[ForwardStats] = []
    for k in FORWARD_HORIZONS:
        xs = [v for o in outcomes if (v := o.forward_pct.get(k)) is not None]
        forward.append(
            ForwardStats(
                horizon=k,
                n=len(xs),
                mean_pct=_mean(xs),
                median_pct=median(xs) if xs else 0.0,
                positive_rate=(sum(1 for x in xs if x > 0) / len(xs)) if xs else 0.0,
            )
        )
    return PatternStats(
        n=n,
        wins=len(wins),
        losses=len(losses),
        expired=sum(1 for o in outcomes if o.result == "expired"),
        open=sum(1 for o in outcomes if o.result == "open"),
        win_rate=len(wins) / n if n else 0.0,
        ci_low=lo,
        ci_high=hi,
        ci_low_adjusted=lo_adj,
        tests=tests,
        break_even=break_even,
        avg_win_pct=_mean([o.move_pct for o in wins]),
        avg_loss_pct=_mean([o.move_pct for o in losses]),
        expectancy_r=_mean([o.r for o in resolved]),
        median_bars=float(median([o.bars for o in resolved])) if resolved else 0.0,
        verdict=verdict_for(n, lo_adj, break_even),
        forward=tuple(forward),
    )
