"""What happened after each event: a fixed ATR bracket, walked forward candle by candle.

ta_patterns gives no stop or target, so every pattern is judged by the same rule:
entry = close of the completing candle, stop = `stop_atr` x ATR(14) against the trade,
target = `target_atr` x ATR in its favour, first touch wins within `max_bars` candles.
A candle touching both counts as a loss (we can't know which came first). Same
conventions as evaluateOutcome() in src/utils/setupAnalysis.ts.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

import numpy as np
import numpy.typing as npt

from tcs.marketdata.candles import Candles

Result = Literal["win", "loss", "expired", "open"]
ATR_PERIOD = 14
FORWARD_HORIZONS: tuple[int, ...] = (5, 10, 20)


@dataclass(frozen=True)
class BracketParams:
    stop_atr: float = 1.0
    target_atr: float = 2.0
    max_bars: int = 30

    @property
    def reward_r(self) -> float:
        return self.target_atr / self.stop_atr


@dataclass(frozen=True)
class Outcome:
    entry: float
    stop: float
    target: float
    atr: float
    result: Result
    exit_index: int | None
    bars: int
    r: float
    move_pct: float
    # Close-to-close move after k candles, signed so positive = in the trade's favour.
    forward_pct: dict[int, float | None]


def atr(candles: Candles, period: int = ATR_PERIOD) -> npt.NDArray[np.float64]:
    """Wilder ATR; NaN until `period` candles exist. Uses only candles up to each index."""
    h, low, c = candles.high, candles.low, candles.close
    n = len(c)
    out = np.full(n, np.nan)
    if n < period + 1:
        return out
    prev_close = np.concatenate(([c[0]], c[:-1]))
    tr = np.maximum.reduce([h - low, np.abs(h - prev_close), np.abs(low - prev_close)])
    tr[0] = h[0] - low[0]
    out[period] = tr[1 : period + 1].mean()
    for i in range(period + 1, n):
        out[i] = (out[i - 1] * (period - 1) + tr[i]) / period
    return out


def evaluate(
    candles: Candles,
    index: int,
    direction: int,
    atr_value: float,
    params: BracketParams,
) -> Outcome:
    c, h, low = candles.close, candles.high, candles.low
    n = len(c)
    entry = float(c[index])
    risk = params.stop_atr * atr_value
    stop = entry - direction * risk
    target = entry + direction * params.target_atr * atr_value

    forward: dict[int, float | None] = {}
    for k in FORWARD_HORIZONS:
        j = index + k
        forward[k] = float(direction * (c[j] / entry - 1) * 100) if j < n else None

    last = min(index + params.max_bars, n - 1)
    for j in range(index + 1, last + 1):
        stopped = low[j] <= stop if direction > 0 else h[j] >= stop
        if stopped:
            return Outcome(
                entry,
                stop,
                target,
                atr_value,
                "loss",
                j,
                j - index,
                -1.0,
                float(direction * (stop / entry - 1) * 100),
                forward,
            )
        hit = h[j] >= target if direction > 0 else low[j] <= target
        if hit:
            return Outcome(
                entry,
                stop,
                target,
                atr_value,
                "win",
                j,
                j - index,
                params.reward_r,
                float(direction * (target / entry - 1) * 100),
                forward,
            )
    ran_out = index + params.max_bars > n - 1
    return Outcome(
        entry,
        stop,
        target,
        atr_value,
        "open" if ran_out else "expired",
        None,
        last - index,
        0.0,
        0.0,
        forward,
    )
