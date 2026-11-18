"""Records of playbook variants: R after costs is what counts, with its uncertainty.

Trailing exits make win rate a poor yardstick (few, large winners), so the headline is the mean
R per trade after costs with a 95% range, and the comparison with the random-entry baseline
(the same trade from a random candle in the trigger window) as a paired difference with its own
95% range. Win rate keeps its Wilson range for reference.

Verdict: ``edge`` needs at least ``MIN_TRADES`` trades, a 95% range of mean R above zero AND a
95% range of the difference from random above zero; ``tooFew`` below ``MIN_TRADES``; else
``noEdge``. Many variants are compared at once, so even ``edge`` is a lead to confirm on newer
data (the out-of-sample segment) and in a forward test, never a promise.
"""

from __future__ import annotations

import math
import statistics
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal

from tcs.analysis.stats import wilson

MIN_TRADES = 30
Z95 = 1.96

Verdict = Literal["edge", "noEdge", "tooFew"]


@dataclass(frozen=True, slots=True)
class ClosedTrade:
    r_net: float
    r_gross: float
    baseline_r: float | None
    bars: int


@dataclass(frozen=True, slots=True)
class RSummary:
    n: int
    wins: int
    win_rate: float
    ci_low: float
    ci_high: float
    mean_r: float
    mean_r_low: float
    mean_r_high: float
    mean_gross_r: float
    avg_win_r: float
    avg_loss_r: float
    #: Sum of winning R / sum of losing R (0 when nothing was lost... or won).
    profit_factor: float
    median_bars: float
    baseline_n: int
    baseline_mean_r: float
    #: Mean of (trade R - its random twin's R), with a 95% range.
    edge_vs_random: float
    edge_vs_random_low: float
    edge_vs_random_high: float
    verdict: Verdict


def _mean_ci(xs: Sequence[float]) -> tuple[float, float, float]:
    if not xs:
        return 0.0, 0.0, 0.0
    m = statistics.fmean(xs)
    if len(xs) < 2:
        return m, -math.inf, math.inf
    half = Z95 * statistics.stdev(xs) / math.sqrt(len(xs))
    return m, m - half, m + half


def summarize_r(trades: Sequence[ClosedTrade]) -> RSummary:
    r = [t.r_net for t in trades]
    n = len(r)
    wins = [x for x in r if x > 0]
    losses = [x for x in r if x <= 0]
    lo, hi = wilson(len(wins), n)
    mean, mlo, mhi = _mean_ci(r)
    paired = [t.r_net - t.baseline_r for t in trades if t.baseline_r is not None]
    base = [t.baseline_r for t in trades if t.baseline_r is not None]
    diff, dlo, dhi = _mean_ci(paired)
    lost = -sum(losses)
    if n < MIN_TRADES:
        verdict: Verdict = "tooFew"
    elif mlo > 0 and dlo > 0:
        verdict = "edge"
    else:
        verdict = "noEdge"
    return RSummary(
        n=n,
        wins=len(wins),
        win_rate=len(wins) / n if n else 0.0,
        ci_low=lo,
        ci_high=hi,
        mean_r=mean,
        mean_r_low=_finite(mlo),
        mean_r_high=_finite(mhi),
        mean_gross_r=statistics.fmean([t.r_gross for t in trades]) if trades else 0.0,
        avg_win_r=statistics.fmean(wins) if wins else 0.0,
        avg_loss_r=statistics.fmean(losses) if losses else 0.0,
        profit_factor=sum(wins) / lost if lost > 0 else 0.0,
        median_bars=statistics.median([t.bars for t in trades]) if trades else 0.0,
        baseline_n=len(base),
        baseline_mean_r=statistics.fmean(base) if base else 0.0,
        edge_vs_random=diff,
        edge_vs_random_low=_finite(dlo),
        edge_vs_random_high=_finite(dhi),
        verdict=verdict,
    )


def _finite(x: float) -> float:
    """JSON has no infinity: an unbounded range end (one trade) is reported as 0."""
    return x if math.isfinite(x) else 0.0
