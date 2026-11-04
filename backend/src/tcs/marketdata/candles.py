"""Column-oriented candle history (what the pattern detectors consume)."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import numpy.typing as npt

FloatArray = npt.NDArray[np.float64]
IntArray = npt.NDArray[np.int64]


@dataclass(frozen=True)
class Candles:
    """Closed candles only, ascending by open time. Times in ms."""

    symbol: str
    interval: str
    open_time: IntArray
    open: FloatArray
    high: FloatArray
    low: FloatArray
    close: FloatArray
    volume: FloatArray

    def __len__(self) -> int:
        return len(self.close)

    @classmethod
    def from_rows(
        cls, symbol: str, interval: str, rows: list[tuple[int, float, float, float, float, float]]
    ) -> Candles:
        """Rows of (open_time, open, high, low, close, volume); sorted and de-duplicated here."""
        by_time = {int(r[0]): r for r in rows}
        ordered = [by_time[t] for t in sorted(by_time)]
        cols = list(zip(*ordered, strict=True)) if ordered else [()] * 6
        return cls(
            symbol=symbol,
            interval=interval,
            open_time=np.asarray(cols[0], dtype=np.int64),
            open=np.asarray(cols[1], dtype=np.float64),
            high=np.asarray(cols[2], dtype=np.float64),
            low=np.asarray(cols[3], dtype=np.float64),
            close=np.asarray(cols[4], dtype=np.float64),
            volume=np.asarray(cols[5], dtype=np.float64),
        )
