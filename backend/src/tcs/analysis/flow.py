"""Order flow at a setup: did aggressive volume agree with its direction?

Two observations, both from the taker (aggressive) buy volume Binance reports per candle, and
both using only candles up to the one that confirmed the setup:

- **Delta**: over the last ``FLOW_BARS`` candles, (aggressive buys - aggressive sells) /
  volume. ``confirms`` when it leans at least ``DELTA_RATIO`` the setup's way, ``against`` when it
  leans that much the other way, ``neutral`` in between.
- **CVD divergence** (bullish): the last ``DIV_BARS`` candles made a lower low than the
  ``DIV_BARS`` before them, but cumulative delta did not (its low in the last window is higher):
  sellers pushed price down with less aggression.

Written once for longs; shorts run the same rule on the mirrored series, where aggressive buyers
and sellers trade places (``mirror``). Thresholds are ratios of volume, so they hold for any coin
and price scale. Unknown (``None``) where any candle in the window has no taker volume.

These are CONTEXT for a setup, measured by the statistics job (does a setup do better when flow
agrees?), never a signal on their own.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

import numpy as np

from tcs.analysis.types import PatternHit
from tcs.common.series import FloatArray, Series, mirror

FLOW_BARS = 3
#: |delta / volume| that counts as leaning one way. Set from the feature's own spread (on real
#: ETH 4h, 3-candle ratios: median |r| = 0.023), never from outcomes: about a quarter of setups
#: fall on each side and the rest are neutral, so every bucket gets cases.
DELTA_RATIO = 0.02
DIV_BARS = 10

Flow = Literal["confirms", "against", "neutral"]
FLOWS: tuple[Flow, ...] = ("confirms", "against", "neutral")


@dataclass(frozen=True, slots=True)
class FlowContext:
    #: Delta / volume over the last ``FLOW_BARS`` candles, signed so + is the setup's way.
    delta_ratio: float | None
    flow: Flow | None
    #: CVD divergence in the setup's favour; None when not measurable.
    divergence: bool | None


UNKNOWN = FlowContext(None, None, None)


def _bullish(s: Series, i: int) -> FlowContext:
    taker = s.taker_buy
    if taker is None or i + 1 < FLOW_BARS:
        return UNKNOWN
    lo = i + 1 - FLOW_BARS
    vol = s.volume[lo : i + 1]
    buy = taker[lo : i + 1]
    total = float(vol.sum())
    if np.isnan(buy).any() or total <= 0:
        return UNKNOWN
    ratio = float((2 * buy - vol).sum()) / total
    flow: Flow = (
        "confirms" if ratio >= DELTA_RATIO else "against" if ratio <= -DELTA_RATIO else "neutral"
    )
    return FlowContext(ratio, flow, _divergence(s, taker, i))


def _divergence(s: Series, taker: FloatArray, i: int) -> bool | None:
    start = i + 1 - 2 * DIV_BARS
    if start < 0:
        return None
    buy = taker[start : i + 1]
    if np.isnan(buy).any():
        return None
    cvd = np.cumsum(2 * buy - s.volume[start : i + 1])
    low = s.low[start : i + 1]
    lower_low = float(low[DIV_BARS:].min()) < float(low[:DIV_BARS].min())
    higher_cvd_low = float(cvd[DIV_BARS:].min()) > float(cvd[:DIV_BARS].min())
    return lower_low and higher_cvd_low


def flow_at(s: Series, hit: PatternHit, mirrored: Series | None = None) -> FlowContext:
    """Order flow when ``hit`` confirmed, in the hit's direction.

    Pass ``mirrored`` (= ``mirror(s)``) when placing many hits, so it is built once.
    """
    if hit.direction == "long":
        return _bullish(s, hit.index)
    return _bullish(mirrored if mirrored is not None else mirror(s), hit.index)


def contexts(f: FlowContext) -> list[str]:
    """Statistics buckets an occurrence belongs to besides ``*`` (every case)."""
    out: list[str] = []
    if f.flow is not None:
        out.append(f"delta:{f.flow}")
    if f.divergence is not None:
        out.append("cvdDiv:yes" if f.divergence else "cvdDiv:no")
    return out


#: Every context bucket, in display order.
CONTEXTS: tuple[str, ...] = (
    *(f"delta:{f}" for f in FLOWS),
    "cvdDiv:yes",
    "cvdDiv:no",
)


def divergence_at(s: Series, i: int) -> bool | None:
    """Bullish CVD divergence when candle ``i`` closes (None without taker volume or history).
    For the bearish twin pass ``mirror(s)``."""
    return _bullish(s, i).divergence
