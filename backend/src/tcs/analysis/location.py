"""Place a setup against zones and order blocks, possibly from a higher timeframe.

Everything is matched by TIME, so the same rule works for same- and cross-timeframe
levels. A level counts only if:

- it was KNOWN before the pattern began (its forming candle had closed by the open
  of the pattern's first candle): price came into an existing level;
- it was still intact when the pattern confirmed (not closed through before then);
- it matches the direction: demand zone / bullish block for longs, supply zone /
  bearish block for shorts;
- the pattern's extreme (low for longs, high for shorts) is inside it, padded by
  ``PAD_ATR`` ATR of the pattern's timeframe.
"""

from __future__ import annotations

import math

from tcs.analysis.types import Location, OrderBlock, PatternHit, Zone
from tcs.common.series import Series

PAD_ATR = 0.25


def _intact(levels: Series, formed: int, end: int | None, start_ms: int, confirm_ms: int) -> bool:
    known_at = levels.close_time(formed)
    broken_at = math.inf if end is None else levels.close_time(end)
    return known_at <= start_ms and broken_at > confirm_ms


def locate(
    hit: PatternHit,
    s: Series,
    atr_at_hit: float,
    levels: Series,
    zones: list[Zone],
    blocks: list[OrderBlock],
) -> Location:
    start_ms = int(s.open_time[hit.start])
    confirm_ms = s.close_time(hit.index)
    pad = PAD_ATR * atr_at_hit if math.isfinite(atr_at_hit) else 0.0
    px = hit.extreme

    def inside(low: float, high: float) -> bool:
        return low - pad <= px <= high + pad

    want_zone = "demand" if hit.direction == "long" else "supply"
    want_block = "bullish" if hit.direction == "long" else "bearish"
    at_zone = any(
        z.kind == want_zone
        and inside(z.low, z.high)
        and _intact(levels, z.formed, z.end, start_ms, confirm_ms)
        for z in zones
    )
    at_block = any(
        b.kind == want_block
        and inside(b.low, b.high)
        and _intact(levels, b.formed, b.end, start_ms, confirm_ms)
        for b in blocks
    )
    if at_zone and at_block:
        return "confluence"
    if at_zone:
        return "zone"
    if at_block:
        return "orderBlock"
    return "openSpace"
