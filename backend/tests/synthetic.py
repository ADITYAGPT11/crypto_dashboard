"""Gapless 24/7-style candles (open == previous close, fat tails, volatility clusters)."""

from __future__ import annotations

import numpy as np

from tcs.marketdata.candles import Candles

H4 = 14_400_000
T0 = 1_700_006_400_000  # a 4h boundary


def crypto_candles(seed: int, n: int = 600, symbol: str = "BTC-USDT") -> Candles:
    r = np.random.default_rng(seed)
    e = r.standard_t(4, n) / np.sqrt(2)
    sig = np.empty(n)
    ret = np.empty(n)
    sig[0] = 0.012
    for i in range(n):
        if i:
            sig[i] = np.sqrt(1e-6 + 0.08 * ret[i - 1] ** 2 + 0.9 * sig[i - 1] ** 2)
        ret[i] = sig[i] * e[i]
    c = 30_000 * np.exp(np.cumsum(ret))
    o = np.r_[30_000, c[:-1]]
    h = np.maximum(o, c) * (1 + np.abs(r.normal(0, sig * 0.6)))
    low = np.minimum(o, c) * (1 - np.abs(r.normal(0, sig * 0.6)))
    v = r.lognormal(10, 0.5, n) * (1 + 20 * np.abs(ret))
    t = T0 + H4 * np.arange(n, dtype=np.int64)
    return Candles(symbol, "4h", t, o, h, low, c, v)


def prefix(c: Candles, n: int) -> Candles:
    return Candles(
        c.symbol,
        c.interval,
        c.open_time[:n],
        c.open[:n],
        c.high[:n],
        c.low[:n],
        c.close[:n],
        c.volume[:n],
    )


def from_ohlc(rows: list[tuple[float, float, float, float]], symbol: str = "BTC-USDT") -> Candles:
    t = T0 + H4 * np.arange(len(rows), dtype=np.int64)
    a = np.asarray(rows, dtype=np.float64).reshape(-1, 4)
    return Candles(symbol, "4h", t, a[:, 0], a[:, 1], a[:, 2], a[:, 3], np.ones(len(rows)))
