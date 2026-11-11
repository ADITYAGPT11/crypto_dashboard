"""Demand and supply zones (base-and-departure, after Sam Seiden's supply/demand method).

- **Base**: 1-``BASE_MAX`` consecutive small-bodied candles (body at most
  ``BASE_BODY_MAX`` of the candle's range): price paused, orders were absorbed.
- **Departure**: the next candle leaves the base explosively: range at least
  ``DEPART_RANGE_ATR`` ATR, body at least ``DEPART_BODY_MIN`` of its range, and it
  closes beyond the whole base. No base, no zone.
- **Demand** (bullish departure): proximal = highest body top in the base,
  distal = lowest low of the base and the departure candle.
  **Supply** mirrors it.

The zone is KNOWN once the departure candle closes (``formed``). It is then walked
forward one candle at a time: a test starts when price trades back into it; the
zone holds that test when a candle closes back outside on the original side, and
breaks (``end``) on a close through the distal edge.
"""

from __future__ import annotations

import numpy as np

from tcs.analysis.indicators import atr
from tcs.analysis.types import Zone, ZoneKind
from tcs.common.series import FloatArray, Series

BASE_MAX = 4
BASE_BODY_MAX = 0.5
DEPART_RANGE_ATR = 1.5
DEPART_BODY_MIN = 0.6
MIN_HEIGHT_ATR = 0.25
DEDUPE_BARS = 10  # skip a zone overlapping an intact same-kind zone this recent


def _body(s: Series, i: int) -> float:
    return abs(float(s.close[i]) - float(s.open[i]))


def _range(s: Series, i: int) -> float:
    return float(s.high[i]) - float(s.low[i])


def _is_base(s: Series, i: int) -> bool:
    r = _range(s, i)
    return r > 0 and _body(s, i) <= BASE_BODY_MAX * r


def detect_zones(s: Series, atrs: FloatArray | None = None) -> list[Zone]:
    a = atr(s) if atrs is None else atrs
    zones: list[Zone] = []
    for i in range(1, len(s)):
        ai = float(a[i - 1])
        if not np.isfinite(ai) or ai <= 0:
            continue
        r, body = _range(s, i), _body(s, i)
        if r < DEPART_RANGE_ATR * ai or body < DEPART_BODY_MIN * r:
            continue
        b1 = i - 1
        b0 = b1
        while b0 - 1 >= 0 and i - (b0 - 1) <= BASE_MAX and _is_base(s, b0 - 1):
            b0 -= 1
        if not _is_base(s, b1):
            continue
        base = slice(b0, b1 + 1)
        tops = np.maximum(s.open[base], s.close[base])
        bottoms = np.minimum(s.open[base], s.close[base])
        close = float(s.close[i])
        kind: ZoneKind
        if s.close[i] > s.open[i]:
            if close <= float(s.high[base].max()):
                continue
            kind = "demand"
            low = min(float(s.low[base].min()), float(s.low[i]))
            high = max(float(tops.max()), low + MIN_HEIGHT_ATR * ai)
            departure = (close - high) / ai
        else:
            if close >= float(s.low[base].min()):
                continue
            kind = "supply"
            high = max(float(s.high[base].max()), float(s.high[i]))
            low = min(float(bottoms.min()), high - MIN_HEIGHT_ATR * ai)
            departure = (low - close) / ai
        if any(
            z.kind == kind
            and (z.end is None or z.end > i)  # intact AT candle i (not at the end of history)
            and i - z.formed <= DEDUPE_BARS
            and z.low <= high
            and low <= z.high
            for z in zones
        ):
            continue
        zones.append(_track(s, kind, low, high, b0, i, departure))
    return zones


def _track(
    s: Series, kind: ZoneKind, low: float, high: float, start: int, formed: int, departure: float
) -> Zone:
    tests = held = 0
    end: int | None = None
    inside = False
    for j in range(formed + 1, len(s)):
        entered = s.low[j] <= high if kind == "demand" else s.high[j] >= low
        if not inside and entered:
            inside = True
            tests += 1
        if not inside:
            continue
        if (s.close[j] < low) if kind == "demand" else (s.close[j] > high):
            end = j
            break
        if (s.close[j] > high) if kind == "demand" else (s.close[j] < low):
            held += 1
            inside = False
    return Zone(kind, low, high, start, formed, end, tests, held, round(departure, 3))
