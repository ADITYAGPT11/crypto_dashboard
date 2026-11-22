"""The trade plan's stop buffer per timeframe and the cost filter (rule set r8, "plan B").

Detectors anchor the stop just beyond the price that invalidates the pattern (0.2 ATR for chart
patterns, 0.1 ATR for candlesticks). The 2026-11-22 trade-plan study (``DECISIONS.md``) found:

- On **1h**, a stop ``STOP_BUFFER_ATR["1h"]`` ATR beyond that anchor did better in both years
  (fewer wick stop-outs, fees a smaller share of the risk). On 4h it was mixed and on 1d it
  hurt, so those keep the detectors' stop.
- A setup whose round-trip fees and slippage would cost more than ``MAX_COST_R`` of its risk is
  skipped: no realistic edge survives that (median 1h cost was 0.09R).

Applied in ``engine.detect_patterns``, so the chart and the statistics use the same plan.
"""

from __future__ import annotations

from dataclasses import replace

import numpy as np

from tcs.analysis import candlesticks, chart_patterns
from tcs.analysis.candlesticks import BEARISH_TWIN, RULES
from tcs.analysis.costs import CostModel
from tcs.analysis.types import PatternHit
from tcs.common.series import FloatArray, Series

#: Total distance beyond the invalidation price, in ATR, where it differs from the detector's.
STOP_BUFFER_ATR: dict[str, float] = {"1h": 0.5}
MAX_COST_R = 0.1
#: Round trip in percent of notional (fees + slippage, both sides; ``costs.CostModel`` defaults).
ROUND_TRIP_PCT = CostModel().round_trip_pct

CANDLESTICKS = frozenset({*RULES, *BEARISH_TWIN.values()})


def detector_pad(pattern: str) -> float:
    return candlesticks.STOP_PAD_ATR if pattern in CANDLESTICKS else chart_patterns.STOP_PAD_ATR


def cost_r(hit: PatternHit) -> float:
    """Round-trip fees and slippage as a share of the risk (funding excluded)."""
    risk_pct = abs(hit.entry - hit.stop) / abs(hit.entry) * 100
    return ROUND_TRIP_PCT / risk_pct if risk_pct > 0 else float("inf")


def apply_plan(hits: list[PatternHit], s: Series, atrs: FloatArray) -> list[PatternHit]:
    buffer = STOP_BUFFER_ATR.get(s.tf)
    out: list[PatternHit] = []
    for h in hits:
        if buffer is not None:
            extra = buffer - detector_pad(h.pattern)
            a = float(atrs[h.index])
            if extra > 0 and np.isfinite(a):
                d = 1.0 if h.direction == "long" else -1.0
                h = replace(h, stop=h.stop - d * extra * a)
        if cost_r(h) > MAX_COST_R:
            continue
        out.append(h)
    return out
