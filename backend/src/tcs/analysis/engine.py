"""``analyze``: the ONE entry point both processes call.

- The chart calls it on the recent (preloaded) candles of one coin.
- The statistics job calls it on one to two years of every coin in the universe.

Same function, same rules, same parameters: a pattern on the chart is measured
by exactly the rules that drew it.
"""

from __future__ import annotations

from dataclasses import dataclass

from tcs.analysis.candlesticks import detect_candlesticks
from tcs.analysis.chart_patterns import detect_chart_patterns
from tcs.analysis.indicators import atr
from tcs.analysis.location import locate
from tcs.analysis.outcomes import Outcome, evaluate
from tcs.analysis.smc import detect_fvgs, detect_structure
from tcs.analysis.trendlines import detect_trendline_patterns
from tcs.analysis.types import Levels, Location, PatternHit
from tcs.analysis.zones import detect_zones
from tcs.common.series import Series


@dataclass(frozen=True, slots=True)
class Occurrence:
    hit: PatternHit
    location: Location
    outcome: Outcome


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
    """Detect, place and resolve every pattern on ``s``.

    ``level_series`` gives zones/order blocks from another (equal or higher)
    timeframe; ``levels`` and ``hits`` may be passed when already computed (the
    statistics job reuses one detection pass across zone timeframes).
    """
    lv_series = level_series if level_series is not None else s
    lv = levels if levels is not None else detect_levels(lv_series)
    a = atr(s)
    occurrences = [
        Occurrence(
            hit,
            locate(hit, s, float(a[hit.index]), lv_series, lv.zones, lv.order_blocks),
            evaluate(s, hit),
        )
        for hit in (hits if hits is not None else detect_patterns(s))
    ]
    return Analysis(s, lv_series, occurrences, lv)
