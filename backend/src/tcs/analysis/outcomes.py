"""What happened after a setup: target before stop, within a holding limit.

Walk forward from the candle after confirmation. If a candle reaches both the
stop and the target we cannot know which came first, so we count the STOP
(conservative). ``expired`` = neither within ``MAX_HOLD_BARS``; ``open`` = the
data ran out first (still running: never counted in statistics).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from tcs.analysis.types import PatternHit
from tcs.common.series import Series

MAX_HOLD_BARS = 30

Result = Literal["win", "loss", "expired", "open"]


@dataclass(frozen=True, slots=True)
class Outcome:
    result: Result
    exit_index: int | None
    #: Percent move from entry to exit in the trade's favour (negative on losses).
    move_pct: float
    #: Reward in R on wins ((target - entry) / risk), -1 on losses, 0 otherwise.
    r: float
    bars: int


def evaluate(s: Series, hit: PatternHit, max_bars: int = MAX_HOLD_BARS) -> Outcome:
    long = hit.direction == "long"
    risk = (hit.entry - hit.stop) if long else (hit.stop - hit.entry)
    reward = (hit.target - hit.entry) if long else (hit.entry - hit.target)
    last = min(hit.index + max_bars, len(s) - 1)
    for j in range(hit.index + 1, last + 1):
        stopped = s.low[j] <= hit.stop if long else s.high[j] >= hit.stop
        if stopped:
            return Outcome("loss", j, -risk / hit.entry * 100, -1.0, j - hit.index)
        reached = s.high[j] >= hit.target if long else s.low[j] <= hit.target
        if reached:
            r = reward / risk if risk > 0 else 0.0
            return Outcome("win", j, reward / hit.entry * 100, r, j - hit.index)
    ran_out = hit.index + max_bars > len(s) - 1
    return Outcome("open" if ran_out else "expired", None, 0.0, 0.0, last - hit.index)
