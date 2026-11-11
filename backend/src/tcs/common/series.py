"""Candles as column arrays: the one data shape every detector works on."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np
import numpy.typing as npt

from tcs.common.timeframes import TF_MS, Timeframe

FloatArray = npt.NDArray[np.float64]
IntArray = npt.NDArray[np.int64]


@dataclass(frozen=True, slots=True)
class Candle:
    open_time: int
    open: float
    high: float
    low: float
    close: float
    volume: float


@dataclass(frozen=True, slots=True)
class Series:
    """Closed candles of one symbol on one timeframe, ascending by open time."""

    symbol: str
    tf: Timeframe
    open_time: IntArray
    open: FloatArray
    high: FloatArray
    low: FloatArray
    close: FloatArray
    volume: FloatArray

    def __len__(self) -> int:
        return int(self.open_time.shape[0])

    @property
    def tf_ms(self) -> int:
        return TF_MS[self.tf]

    def close_time(self, i: int) -> int:
        """Moment candle ``i`` closed: when anything confirmed on it became known."""
        return int(self.open_time[i]) + self.tf_ms

    def head(self, n: int) -> Series:
        """The first ``n`` candles (what was known when candle ``n - 1`` closed)."""
        return self.slice(0, n)

    def tail(self, n: int) -> Series:
        return self.slice(max(0, len(self) - n), len(self))

    def slice(self, start: int, stop: int) -> Series:
        return Series(
            self.symbol,
            self.tf,
            self.open_time[start:stop],
            self.open[start:stop],
            self.high[start:stop],
            self.low[start:stop],
            self.close[start:stop],
            self.volume[start:stop],
        )

    def scaled(self, factor: float) -> Series:
        """Prices multiplied by ``factor`` (scale-invariance tests)."""
        return Series(
            self.symbol,
            self.tf,
            self.open_time,
            self.open * factor,
            self.high * factor,
            self.low * factor,
            self.close * factor,
            self.volume,
        )

    @staticmethod
    def from_candles(symbol: str, tf: Timeframe, candles: Sequence[Candle]) -> Series:
        return Series(
            symbol,
            tf,
            np.array([c.open_time for c in candles], dtype=np.int64),
            np.array([c.open for c in candles], dtype=np.float64),
            np.array([c.high for c in candles], dtype=np.float64),
            np.array([c.low for c in candles], dtype=np.float64),
            np.array([c.close for c in candles], dtype=np.float64),
            np.array([c.volume for c in candles], dtype=np.float64),
        )

    def candles(self) -> list[Candle]:
        return [
            Candle(
                int(self.open_time[i]),
                float(self.open[i]),
                float(self.high[i]),
                float(self.low[i]),
                float(self.close[i]),
                float(self.volume[i]),
            )
            for i in range(len(self))
        ]


def mirror(s: Series) -> Series:
    """The series upside down: prices negated, highs and lows swapped.

    A bearish pattern on ``s`` is the bullish pattern on ``mirror(s)``, so each
    chart pattern is written once and both directions share the same rule.
    ATR is unchanged (true range uses absolute differences).
    """
    return Series(s.symbol, s.tf, s.open_time, -s.open, -s.low, -s.high, -s.close, s.volume)
