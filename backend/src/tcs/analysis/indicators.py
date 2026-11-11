"""Indicators the rules depend on, from TA-Lib (the industry reference implementation)."""

from __future__ import annotations

import numpy as np
import talib

from tcs.common.series import FloatArray, Series

ATR_PERIOD = 14


def atr(s: Series, period: int = ATR_PERIOD) -> FloatArray:
    """Wilder's average true range; NaN until ``period`` candles have closed."""
    if len(s) <= period:
        return np.full(len(s), np.nan)
    return np.asarray(talib.ATR(s.high, s.low, s.close, timeperiod=period), dtype=np.float64)


def sma(values: FloatArray, period: int) -> FloatArray:
    if values.shape[0] < period:
        return np.full(values.shape[0], np.nan)
    return np.asarray(talib.SMA(values, timeperiod=period), dtype=np.float64)


def ema(values: FloatArray, period: int) -> FloatArray:
    if values.shape[0] < period:
        return np.full(values.shape[0], np.nan)
    return np.asarray(talib.EMA(values, timeperiod=period), dtype=np.float64)
