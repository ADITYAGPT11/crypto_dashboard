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
