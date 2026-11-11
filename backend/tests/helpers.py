"""Fixtures: hand-drawn price paths, seeded random walks and real (archived) candles."""

from __future__ import annotations

import gzip
import itertools
from pathlib import Path

import numpy as np

from tcs.common.series import Candle, Series
from tcs.common.timeframes import TF_MS, Timeframe

FIXTURES = Path(__file__).parent / "fixtures"


def path(points: list[tuple[int, float]], tf: Timeframe = "1h", wick: float = 0.5) -> Series:
    """Candles walking straight between (index, price) waypoints, each with +-``wick`` wicks."""
    out: list[Candle] = []
    for (i0, p0), (i1, p1) in itertools.pairwise(points):
        for i in range(i0, i1):
            o = p0 + (p1 - p0) * (i - i0) / (i1 - i0)
            c = p0 + (p1 - p0) * (i + 1 - i0) / (i1 - i0)
            out.append(Candle(i * TF_MS[tf], o, max(o, c) + wick, min(o, c) - wick, c, 100.0))
    return Series.from_candles("TEST-USDT", tf, out)


def candles(rows: list[tuple[float, float, float, float]], tf: Timeframe = "1h") -> Series:
    """Explicit (open, high, low, close) rows."""
    return Series.from_candles(
        "TEST-USDT",
        tf,
        [Candle(i * TF_MS[tf], o, h, lo, c, 100.0) for i, (o, h, lo, c) in enumerate(rows)],
    )


def random_walk(seed: int, n: int = 700, tf: Timeframe = "1h") -> Series:
    """Gapless OHLC random walk with trending stretches (so every pattern can occur)."""
    rng = np.random.default_rng(seed)
    drift = np.repeat(rng.normal(0, 0.004, n // 50 + 1), 50)[:n]
    rets = drift + rng.normal(0, 0.012, n)
    close = 100 * np.exp(np.cumsum(rets))
    open_ = np.concatenate([[100.0], close[:-1]])
    span = np.abs(rng.normal(0, 0.008, n)) * close
    high = np.maximum(open_, close) + span * rng.random(n)
    low = np.minimum(open_, close) - span * rng.random(n)
    vol = rng.lognormal(5, 0.5, n)
    return Series(
        "WALK-USDT",
        tf,
        np.arange(n, dtype=np.int64) * TF_MS[tf],
        open_,
        high,
        low,
        close,
        vol,
    )


def real_eth_4h() -> Series:
    """ETH-USDT perpetual, 4h, 2025-11 .. 2026-10, from data.binance.vision."""
    out: list[Candle] = []
    with gzip.open(FIXTURES / "ETHUSDT-4h-2025-11_2026-10.csv.gz", "rt") as f:
        next(f)
        for line in f:
            p = line.strip().split(",")
            out.append(Candle(int(p[0]), *(float(x) for x in p[1:6])))
    return Series.from_candles("ETH-USDT", "4h", out)
