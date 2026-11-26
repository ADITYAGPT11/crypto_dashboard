"""``analyze``: the ONE entry point for pattern analysis.

Detects every pattern on a series, places it against zones and order blocks, and scores the
context it formed in with the setup checklist (``checklist.py``). The chart API and the scanner
both call it, so a pattern shows the same checks wherever it appears.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from tcs.analysis.candlesticks import detect_candlesticks
from tcs.analysis.chart_patterns import detect_chart_patterns
from tcs.analysis.checklist import Checklist, checker, formation_volume
from tcs.analysis.indicators import atr
from tcs.analysis.location import locate
from tcs.analysis.smc import detect_fvgs, detect_structure
from tcs.analysis.sweeps import detect_sweeps
from tcs.analysis.trendlines import detect_trendline_patterns
from tcs.analysis.types import Levels, Location, PatternHit
from tcs.analysis.zones import detect_zones
from tcs.common.series import Series, mirror


@dataclass(frozen=True, slots=True)
class Occurrence:
    hit: PatternHit
    location: Location
    #: The setup checklist at confirmation (checklist.py): six yes/no facts, score 0-6.
    checklist: Checklist
    #: Volume trend while the pattern formed (flags, triangles, wedges); not a check.
    formation_volume: Literal["falling", "rising"] | None = None


@dataclass(frozen=True, slots=True)
class Analysis:
    series: Series
    #: Candles the levels were found on (the pattern series itself, or a higher timeframe).
    level_series: Series
    occurrences: list[Occurrence]
    levels: Levels


def detect_patterns(s: Series) -> list[PatternHit]:
    a = atr(s)
    hits = [
        *detect_chart_patterns(s, a),
        *detect_trendline_patterns(s, a),
        *detect_candlesticks(s, a),
        *detect_sweeps(s, a),
    ]
    return sorted(hits, key=lambda h: (h.index, h.pattern))


def detect_levels(s: Series) -> Levels:
    a = atr(s)
    structure, blocks = detect_structure(s)
    return Levels(
        zones=detect_zones(s, a), order_blocks=blocks, fvgs=detect_fvgs(s, a), structure=structure
    )


def analyze(
    s: Series,
    level_series: Series | None = None,
    levels: Levels | None = None,
    hits: list[PatternHit] | None = None,
) -> Analysis:
    """Detect, place and check every pattern on ``s``.

    ``level_series`` gives zones/order blocks from another (equal or higher) timeframe;
    ``levels`` and ``hits`` may be passed when already computed.
    """
    lv_series = level_series if level_series is not None else s
    lv = levels if levels is not None else detect_levels(lv_series)
    a = atr(s)
    found = hits if hits is not None else detect_patterns(s)
    mirrored = mirror(s) if any(h.direction == "short" for h in found) else None
    check = checker(s, mirrored)
    occurrences: list[Occurrence] = []
    for hit in found:
        location = locate(hit, s, float(a[hit.index]), lv_series, lv.zones, lv.order_blocks)
        occurrences.append(
            Occurrence(hit, location, check(hit, location), formation_volume(s, hit))
        )
    return Analysis(s, lv_series, occurrences, lv)
