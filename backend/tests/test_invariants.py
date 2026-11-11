"""Properties every detector must have, checked on random walks and real candles.

1. No look-ahead: a hit confirmed on candle i is found, identically, with only
   candles 0..i (the way the chart sees it when that candle closes).
2. Scale invariance: multiplying prices by 1000 finds the same hits (thresholds
   are in ATR, not dollars).
3. Determinism: running twice gives the same result.
4. Symmetry: every bearish chart pattern is the bullish rule on the mirrored series.
"""

from __future__ import annotations

from collections.abc import Callable

import pytest

from tcs.analysis.candlesticks import detect_candlesticks
from tcs.analysis.chart_patterns import BEARISH_TWIN as CHART_TWIN
from tcs.analysis.chart_patterns import detect_chart_patterns
from tcs.analysis.engine import detect_levels, detect_patterns
from tcs.analysis.smc import detect_fvgs, detect_structure
from tcs.analysis.trendlines import BEARISH_TWIN as LINE_TWIN
from tcs.analysis.trendlines import detect_trendline_patterns
from tcs.analysis.types import PatternHit
from tcs.analysis.zones import detect_zones
from tcs.common.series import Series, mirror

from .helpers import random_walk, real_eth_4h

Detector = Callable[[Series], list[PatternHit]]
DETECTORS: dict[str, Detector] = {
    "candlesticks": lambda s: detect_candlesticks(s),
    "chart": lambda s: detect_chart_patterns(s),
    "trendlines": lambda s: detect_trendline_patterns(s),
}
SERIES = {f"walk{seed}": random_walk(seed) for seed in (1, 2, 3, 4)}
SERIES["eth4h"] = real_eth_4h().tail(900)


def key(h: PatternHit) -> tuple[str, str, int, float, float, float, int]:
    return (h.pattern, h.direction, h.index, h.entry, h.stop, h.target, h.start)


def sample[T](items: list[T], k: int = 25) -> list[T]:
    step = max(1, len(items) // k)
    return items[::step]


@pytest.mark.parametrize("series", SERIES.values(), ids=SERIES.keys())
@pytest.mark.parametrize("detector", DETECTORS.values(), ids=DETECTORS.keys())
def test_no_look_ahead(detector: Detector, series: Series) -> None:
    hits = detector(series)
    for h in sample(hits):
        prefix = {key(p) for p in detector(series.head(h.index + 1))}
        assert key(h) in prefix, f"{h.pattern} at {h.index} needs later candles"


@pytest.mark.parametrize("series", SERIES.values(), ids=SERIES.keys())
@pytest.mark.parametrize("detector", DETECTORS.values(), ids=DETECTORS.keys())
def test_scale_invariant_and_deterministic(detector: Detector, series: Series) -> None:
    base = detector(series)
    assert [key(h) for h in base] == [key(h) for h in detector(series)]
    scaled = detector(series.scaled(1000.0))
    assert [(h.pattern, h.index) for h in scaled] == [(h.pattern, h.index) for h in base]
    for a, b in zip(base, scaled, strict=True):
        assert b.entry == pytest.approx(a.entry * 1000, rel=1e-9)
        assert b.stop == pytest.approx(a.stop * 1000, rel=1e-9)
        assert b.target == pytest.approx(a.target * 1000, rel=1e-9)


@pytest.mark.parametrize("series", SERIES.values(), ids=SERIES.keys())
def test_bearish_patterns_are_mirrored_bullish_ones(series: Series) -> None:
    twins = {**CHART_TWIN, **LINE_TWIN}
    flipped = mirror(series)

    def both(s: Series) -> list[PatternHit]:
        return [*detect_chart_patterns(s), *detect_trendline_patterns(s)]

    bull = {(h.pattern, h.index) for h in both(series) if h.direction == "long"}
    bear_on_mirror = {
        (next(k for k, v in twins.items() if v == h.pattern), h.index)
        for h in both(flipped)
        if h.direction == "short"
    }
    assert bull == bear_on_mirror


@pytest.mark.parametrize("series", SERIES.values(), ids=SERIES.keys())
def test_levels_known_when_formed(series: Series) -> None:
    """A zone / block / gap formed on candle f exists, with the same edges, at f's close."""
    lv = detect_levels(series)
    for z in sample(lv.zones):
        early = detect_zones(series.head(z.formed + 1))
        assert any(
            (e.kind, e.low, e.high, e.formed) == (z.kind, z.low, z.high, z.formed) for e in early
        )
    for b in sample(lv.order_blocks):
        _, early_blocks = detect_structure(series.head(b.formed + 1))
        assert any(
            (e.kind, e.low, e.high, e.formed) == (b.kind, b.low, b.high, b.formed)
            for e in early_blocks
        )
    for g in sample(lv.fvgs):
        early_gaps = detect_fvgs(series.head(g.formed + 1))
        assert any((e.kind, e.low, e.high) == (g.kind, g.low, g.high) for e in early_gaps)


def test_every_pattern_in_the_catalogue_can_fire() -> None:
    """Guards against a rule that silently never triggers on real data."""
    from tcs.analysis.catalog import PATTERN_IDS

    seen: set[str] = set()
    for s in [real_eth_4h(), *(random_walk(seed, 3000) for seed in range(5, 12))]:
        seen |= {h.pattern for h in detect_patterns(s)}
    rare = {"hangingMan", "invertedHammer", "shootingStar", "morningStar", "eveningStar"}
    missing = set(PATTERN_IDS) - seen - rare
    assert not missing, f"never fired: {sorted(missing)}"
