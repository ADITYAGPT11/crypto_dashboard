"""What a setup costs to trade, in R (multiples of the trade's own risk).

Three costs, all as a percent of the position's notional, divided by the risk in percent
(|entry - stop| / entry), so a tight stop pays relatively more:

- **fees**: taker on entry and exit (Binance USDⓈ-M regular tier, 0.05% a side);
- **slippage**: an allowance per side for filling worse than the candle's price;
- **funding**: the perpetual's funding events between entry (the confirmation close) and exit
  (the exit candle's close). Longs pay a positive rate and receive a negative one; shorts the
  reverse. After the last known event the last rate is carried forward at the last interval and
  the cost is flagged as estimated.

Statistics are reported after these costs; the gross figures stay alongside.
"""

from __future__ import annotations

import bisect
import itertools
from collections.abc import Sequence
from dataclasses import dataclass

from tcs.analysis.types import PatternHit


@dataclass(frozen=True, slots=True)
class CostModel:
    #: Exchange fee per side, percent of notional (taker; maker would be 0.02%).
    fee_pct: float = 0.05
    #: Slippage allowance per side, percent of notional.
    slippage_pct: float = 0.025

    @property
    def round_trip_pct(self) -> float:
        return round(2 * (self.fee_pct + self.slippage_pct), 6)


@dataclass(frozen=True, slots=True)
class Cost:
    fees_r: float
    #: Funding paid in R (negative = received).
    funding_r: float
    #: Part of the holding time lay after the last known funding event.
    estimated: bool

    @property
    def total_r(self) -> float:
        return self.fees_r + self.funding_r


class Funding:
    """Funding events of one perpetual: times (ms, ascending) and rates (percent)."""

    def __init__(self, rows: Sequence[tuple[int, float]]) -> None:
        self.times = [t for t, _ in rows]
        self.rates = [r for _, r in rows]
        # running sum, so any window costs two lookups
        self._cum = [0.0]
        for r in self.rates:
            self._cum.append(self._cum[-1] + r)
        tail = self.times[-4:]
        gaps = sorted(b - a for a, b in itertools.pairwise(tail) if b > a)
        #: Spacing of the latest events (8 h on most perpetuals, 4 h on some).
        self.interval = gaps[len(gaps) // 2] if gaps else 8 * 3_600_000

    def paid_pct(self, direction: str, start: int, end: int) -> tuple[float, bool]:
        """Percent of notional paid by a position held over (start, end]; and whether estimated."""
        if end <= start or not self.times:
            return 0.0, bool(not self.times and end > start)
        sign = 1.0 if direction == "long" else -1.0
        i = bisect.bisect_right(self.times, start)
        j = bisect.bisect_right(self.times, end)
        total = self._cum[j] - self._cum[i]
        last = self.times[-1]
        estimated = False
        if end > last:
            first_unknown = max(start, last)
            events = (end - last) // self.interval - (first_unknown - last) // self.interval
            if events > 0:
                total += events * self.rates[-1]
                estimated = True
        return sign * total, estimated


NO_FUNDING = Funding([])


def trade_cost(
    model: CostModel,
    funding: Funding,
    hit: PatternHit,
    entry_time: int,
    exit_time: int,
) -> Cost:
    """Cost of ``hit`` entered at ``entry_time`` and closed at ``exit_time`` (both ms)."""
    risk_pct = abs(hit.entry - hit.stop) / hit.entry * 100 if hit.entry else 0.0
    if risk_pct <= 0:
        return Cost(0.0, 0.0, False)
    paid, estimated = funding.paid_pct(hit.direction, entry_time, exit_time)
    return Cost(model.round_trip_pct / risk_pct, paid / risk_pct, estimated)
