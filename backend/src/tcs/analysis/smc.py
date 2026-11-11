"""Market structure, order blocks and fair value gaps (ICT / "smart money concepts").

Written in-house: the ``smart-money-concepts`` package marks swings with future
candles (look-ahead), which would leak into statistics. Here every swing is used
only once it is known (``Swing.known_at``).

- **Structure break**: the first close beyond the latest known, unbroken swing.
  A break in the trend's direction is a BOS; the first break against it a CHoCH.
- **Order block**: for a bullish break, the last down candle (close < open) at or
  just before the lowest low between the broken swing and the break: the origin of
  the displacement. Zone = that candle's full range. Known once the break closes;
  ``mitigated`` on the first trade back into it; ends on a close through it.
  Bearish blocks mirror this.
- **Fair value gap**: candle 1's high below candle 3's low (bullish) or above it
  (bearish), at least ``FVG_MIN_ATR`` ATR wide. Known once candle 3 closes; filled
  once price trades through the whole gap.
"""

from __future__ import annotations

from typing import Literal

import numpy as np

from tcs.analysis.indicators import atr
from tcs.analysis.swings import SWING_BARS, Swing, swing_highs, swing_lows
from tcs.analysis.types import FairValueGap, OrderBlock, StructureBreak
from tcs.common.series import FloatArray, Series

OB_LOOKBACK = 5  # candles back from the displacement low to look for the last opposite candle
FVG_MIN_ATR = 0.1


def _order_block(s: Series, swing: Swing, c: int, bullish: bool) -> tuple[int, float, float] | None:
    seg = slice(swing.index + 1, c + 1)
    if seg.start >= seg.stop:
        return None
    extremes = s.low[seg] if bullish else s.high[seg]
    rel = int(np.argmin(extremes)) if bullish else int(np.argmax(extremes))
    origin = swing.index + 1 + rel
    for j in range(origin, max(swing.index + 1, origin - OB_LOOKBACK) - 1, -1):
        opposite = s.close[j] < s.open[j] if bullish else s.close[j] > s.open[j]
        if opposite:
            return j, float(s.low[j]), float(s.high[j])
    return None


def _track_block(s: Series, j: int, formed: int, low: float, high: float, bullish: bool):
    mitigated: int | None = None
    end: int | None = None
    for k in range(formed + 1, len(s)):
        if mitigated is None and (s.low[k] <= high if bullish else s.high[k] >= low):
            mitigated = k
        if (s.close[k] < low) if bullish else (s.close[k] > high):
            end = k
            break
    return mitigated, end


def detect_structure(s: Series) -> tuple[list[StructureBreak], list[OrderBlock]]:
    highs, lows = swing_highs(s, SWING_BARS), swing_lows(s, SWING_BARS)
    breaks: list[StructureBreak] = []
    blocks: list[OrderBlock] = []
    hi_ptr = lo_ptr = 0
    last_high: Swing | None = None
    last_low: Swing | None = None
    trend: Literal["up", "down"] | None = None
    for c in range(len(s)):
        while hi_ptr < len(highs) and highs[hi_ptr].known_at <= c:
            last_high = highs[hi_ptr]
            hi_ptr += 1
        while lo_ptr < len(lows) and lows[lo_ptr].known_at <= c:
            last_low = lows[lo_ptr]
            lo_ptr += 1
        close = float(s.close[c])
        for swing, up in ((last_high, True), (last_low, False)):
            if swing is None or swing.index >= c:
                continue
            broke = close > swing.price if up else close < swing.price
            if not broke:
                continue
            direction: Literal["up", "down"] = "up" if up else "down"
            kind: Literal["bos", "choch"] = "bos" if trend in (None, direction) else "choch"
            breaks.append(StructureBreak(kind, direction, swing.price, swing.index, c))
            trend = direction
            ob = _order_block(s, swing, c, bullish=up)
            if ob is not None:
                j, low, high = ob
                mitigated, end = _track_block(s, j, c, low, high, bullish=up)
                blocks.append(
                    OrderBlock(
                        "bullish" if up else "bearish", low, high, j, c, end, mitigated, swing.price
                    )
                )
            if up:
                last_high = None  # each swing breaks once
            else:
                last_low = None
    return breaks, blocks


def detect_fvgs(s: Series, atrs: FloatArray | None = None) -> list[FairValueGap]:
    a = atr(s) if atrs is None else atrs
    gaps: list[FairValueGap] = []
    for k in range(2, len(s)):
        ak = float(a[k])
        if not np.isfinite(ak) or ak <= 0:
            continue
        h1, l1, h3, l3 = (
            float(s.high[k - 2]),
            float(s.low[k - 2]),
            float(s.high[k]),
            float(s.low[k]),
        )
        if l3 - h1 >= FVG_MIN_ATR * ak:
            low, high, kind = h1, l3, "bullish"
        elif l1 - h3 >= FVG_MIN_ATR * ak:
            low, high, kind = h3, l1, "bearish"
        else:
            continue
        filled: int | None = None
        for m in range(k + 1, len(s)):
            if (s.low[m] <= low) if kind == "bullish" else (s.high[m] >= high):
                filled = m
                break
        gaps.append(FairValueGap(kind, low, high, k - 1, k, filled))
    return gaps
