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


def rsi(values: FloatArray, period: int = 14) -> FloatArray:
    """Wilder's RSI; NaN until ``period`` candles have closed."""
    if values.shape[0] <= period:
        return np.full(values.shape[0], np.nan)
    return np.asarray(talib.RSI(values, timeperiod=period), dtype=np.float64)


def rolling_vwap(s: Series, period: int = 20) -> FloatArray:
    """Volume-weighted average of the typical price over the last ``period`` candles.

    Rolling rather than session-anchored, so it means the same on 15m and 1d candles.
    """
    tp = (s.high + s.low + s.close) / 3.0
    pv = np.concatenate(([0.0], np.cumsum(tp * s.volume)))
    v = np.concatenate(([0.0], np.cumsum(s.volume)))
    out = np.full(len(s), np.nan)
    if len(s) >= period:
        num = pv[period:] - pv[:-period]
        den = v[period:] - v[:-period]
        with np.errstate(invalid="ignore", divide="ignore"):
            out[period - 1 :] = np.where(den > 0, num / den, np.nan)
    return out


def supertrend(s: Series, period: int = 10, mult: float = 3.0) -> FloatArray:
    """Supertrend direction per candle: +1 up, -1 down, 0 before ATR exists.

    Standard construction: bands at hl2 +- ``mult`` x ATR(``period``), each band only tightens
    while price stays on its side; the trend flips when a close crosses the opposite band.
    """
    n = len(s)
    out = np.zeros(n)
    a = atr(s, period)
    hl2 = (s.high + s.low) / 2.0
    up_b = hl2 + mult * a
    lo_b = hl2 - mult * a
    fu = fl = np.nan
    trend = 0
    for i in range(n):
        if not np.isfinite(a[i]):
            continue
        if trend == 0:
            fu, fl = float(up_b[i]), float(lo_b[i])
            trend = 1 if s.close[i] >= hl2[i] else -1
            out[i] = trend
            continue
        prev_close = float(s.close[i - 1])
        fu = float(up_b[i]) if up_b[i] < fu or prev_close > fu else fu
        fl = float(lo_b[i]) if lo_b[i] > fl or prev_close < fl else fl
        if trend > 0 and s.close[i] < fl:
            trend = -1
        elif trend < 0 and s.close[i] > fu:
            trend = 1
        out[i] = trend
    return out
