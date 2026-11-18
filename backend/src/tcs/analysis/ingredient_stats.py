"""What price did after an ingredient's signal: the move in its direction, before costs.

For every signal candle ``t`` the move is ``direction x (close[t+h] - close[t]) / ATR[t]``: in ATR
units, so coins and years are comparable (also kept in percent). Signals of one ingredient on one
coin never overlap: after a signal at ``t`` the next one counted is at ``t + h`` or later, so each
move is counted once and the samples are close to independent (a state ingredient is sampled
every ``h`` candles).

The 95% range of the mean is reported as usual and Bonferroni-adjusted for the number of
ingredient x horizon pairs tested at once, so a "significant" result is not just one of many
draws. The cost of a round trip (Binance taker 0.05% + 0.02% slippage, both ways) is converted
to ATR per signal, to show whether a direction edge would survive costs.
"""

from __future__ import annotations

import math
import statistics
from collections.abc import Sequence
from dataclasses import dataclass
from statistics import NormalDist
from typing import Literal

import numpy as np

from tcs.analysis.indicators import atr
from tcs.analysis.ingredients import Signal
from tcs.common.series import Series

#: Forward horizons in 4h candles: 4 hours, 1 day, 4 days.
HORIZONS: tuple[int, ...] = (1, 6, 24)
#: Round trip as a share of the price: taker 0.05% + slippage 0.02%, in and out.
ROUND_TRIP = 2 * (0.0005 + 0.0002)
MIN_MOVES = 30

Verdict = Literal["edgeAfterCosts", "edgeBeforeCosts", "reversed", "inconsistent", "none", "tooFew"]


@dataclass(frozen=True, slots=True)
class Move:
    t: int
    #: Open time (ms) of the signal candle.
    time: int
    atr_move: float
    pct_move: float
    cost_atr: float


def forward_moves(s: Series, sig: Signal, h: int, atrs: np.ndarray | None = None) -> list[Move]:
    a = atr(s) if atrs is None else atrs
    out: list[Move] = []
    nxt = 0
    for t in range(len(s) - h):
        d = int(sig[t])
        if d == 0 or t < nxt:
            continue
        at = float(a[t])
        c0 = float(s.close[t])
        if not math.isfinite(at) or at <= 0 or c0 <= 0:
            continue
        move = d * (float(s.close[t + h]) - c0)
        out.append(Move(t, int(s.open_time[t]), move / at, move / c0 * 100, ROUND_TRIP * c0 / at))
        nxt = t + h
    return out


@dataclass(frozen=True, slots=True)
class MoveSummary:
    n: int
    #: Mean move in the signal's direction, ATR units, with 95% and adjusted 95% ranges.
    mean_atr: float
    low: float
    high: float
    low_adj: float
    high_adj: float
    mean_pct: float
    #: Share of signals followed by a move their way.
    hit_rate: float
    #: Average round-trip cost in ATR, and the mean move after it with its adjusted range.
    cost_atr: float
    net_atr: float
    net_low_adj: float


def _ci(xs: Sequence[float], z: float) -> tuple[float, float]:
    if len(xs) < 2:
        return (-math.inf, math.inf)
    half = z * statistics.stdev(xs) / math.sqrt(len(xs))
    m = statistics.fmean(xs)
    return (m - half, m + half)


def z_adjusted(tests: int, alpha: float = 0.05) -> float:
    """Two-sided z for a Bonferroni-corrected level over ``tests`` tests."""
    return NormalDist().inv_cdf(1 - alpha / (2 * max(1, tests)))


def summarize_moves(moves: Sequence[Move], tests: int) -> MoveSummary:
    xs = [m.atr_move for m in moves]
    net = [m.atr_move - m.cost_atr for m in moves]
    n = len(xs)
    z = z_adjusted(tests)
    lo, hi = _ci(xs, 1.96)
    lo_a, hi_a = _ci(xs, z)
    nlo_a, _ = _ci(net, z)
    fin = lambda v: v if math.isfinite(v) else 0.0  # noqa: E731
    return MoveSummary(
        n=n,
        mean_atr=statistics.fmean(xs) if xs else 0.0,
        low=fin(lo),
        high=fin(hi),
        low_adj=fin(lo_a),
        high_adj=fin(hi_a),
        mean_pct=statistics.fmean([m.pct_move for m in moves]) if moves else 0.0,
        hit_rate=sum(x > 0 for x in xs) / n if n else 0.0,
        cost_atr=statistics.fmean([m.cost_atr for m in moves]) if moves else 0.0,
        net_atr=statistics.fmean(net) if net else 0.0,
        net_low_adj=fin(nlo_a),
    )


def verdict(all_: MoveSummary, new_coins: MoveSummary, newer: MoveSummary) -> Verdict:
    """Predictive only if the adjusted range excludes zero on every coin AND the sign holds on
    coins and months the study was not designed on (the 15 extra coins, the latest 30%)."""
    if all_.n < MIN_MOVES or new_coins.n < MIN_MOVES or newer.n < MIN_MOVES:
        return "tooFew"
    if all_.low_adj > 0:
        if new_coins.mean_atr > 0 and newer.mean_atr > 0:
            return "edgeAfterCosts" if all_.net_low_adj > 0 else "edgeBeforeCosts"
        return "inconsistent"
    if all_.high_adj < 0:
        return "reversed" if new_coins.mean_atr < 0 and newer.mean_atr < 0 else "inconsistent"
    return "none"
