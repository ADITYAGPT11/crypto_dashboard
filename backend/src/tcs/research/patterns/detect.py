"""Run the detectors and turn their per-candle flags into pattern events."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import numpy.typing as npt
import ta_patterns as tap
import ta_patterns.chart_patterns as cp

from tcs.marketdata.candles import Candles
from tcs.research.patterns.catalog import Kind, catalog

Signals = dict[str, npt.NDArray[np.int8]]


@dataclass(frozen=True)
class Event:
    """A pattern completing on candle `index` (its close is the earliest possible entry)."""

    pattern: str
    index: int
    direction: int  # +1 long, -1 short


def scan(candles: Candles, kinds: tuple[Kind, ...]) -> Signals:
    """Raw detector output (+1/-1/0 per candle) for every catalogued pattern of these kinds."""
    o, h, low, c, v = candles.open, candles.high, candles.low, candles.close, candles.volume
    raw: Signals = {}
    if len(candles) == 0:
        return raw
    if "chart" in kinds or "short" in kinds:
        raw.update(cp.chart_scan_all(o, h, low, c, v=v))
    if "candlestick" in kinds:
        raw.update(tap.scan_all(o, h, low, c))
    known = catalog()
    return {
        k: np.asarray(a, dtype=np.int8)
        for k, a in raw.items()
        if k in known and known[k].kind in kinds
    }


def events(signals: Signals) -> list[Event]:
    """One event per run of identical flags, on the run's first candle.

    Several detectors (e.g. double_bottom) flag every candle while the pattern stays valid;
    only the first candle of a run is the moment the pattern completed. Uses candle i-1 and i
    only, so it adds no look-ahead.
    """
    out: list[Event] = []
    for name, sig in signals.items():
        prev = np.concatenate(([0], sig[:-1])).astype(np.int8)
        starts = np.flatnonzero((sig != 0) & (sig != prev))
        out.extend(Event(name, int(i), int(np.sign(sig[i]))) for i in starts)
    out.sort(key=lambda e: (e.index, e.pattern))
    return out
