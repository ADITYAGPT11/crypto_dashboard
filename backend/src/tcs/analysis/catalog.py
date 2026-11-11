"""The pattern catalogue: every setup the rules can confirm, with its source.

Definitions follow the standard references; where crypto's 24/7 market forces a
change (no session gaps), the deviation is written down in ``docs/product/patterns.md``.

- Bulkowski, *Encyclopedia of Chart Patterns* (3rd ed., 2021)
- Edwards & Magee, *Technical Analysis of Stock Trends* (11th ed.)
- Nison, *Japanese Candlestick Charting Techniques* (2nd ed.)
- TA-Lib candlestick functions (the de-facto reference implementation)
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

#: Bump when ANY rule, threshold or outcome rule changes. Statistics are stored per version.
RULESET_VERSION = "2026.11-r1"

Kind = Literal["chart", "candlestick"]
Bias = Literal["long", "short", "either"]


@dataclass(frozen=True, slots=True)
class PatternSpec:
    id: str
    label: str
    kind: Kind
    bias: Bias
    source: str
    summary: str


CATALOG: tuple[PatternSpec, ...] = (
    # Chart patterns (in-house, ATR-scaled; see chart_patterns.py and trendlines.py)
    PatternSpec(
        "doubleBottom",
        "Double bottom",
        "chart",
        "long",
        "Bulkowski ch. 'Double Bottoms'",
        "Two similar swing lows; confirmed on a close above the peak between them.",
    ),
    PatternSpec(
        "doubleTop",
        "Double top",
        "chart",
        "short",
        "Bulkowski ch. 'Double Tops'",
        "Two similar swing highs; confirmed on a close below the trough between them.",
    ),
    PatternSpec(
        "inverseHeadShoulders",
        "Inverse head and shoulders",
        "chart",
        "long",
        "Edwards & Magee ch. 6; Bulkowski 'Head-and-Shoulders Bottoms'",
        "Three swing lows, the middle lowest; confirmed on a close above the neckline.",
    ),
    PatternSpec(
        "headShoulders",
        "Head and shoulders",
        "chart",
        "short",
        "Edwards & Magee ch. 6; Bulkowski 'Head-and-Shoulders Tops'",
        "Three swing highs, the middle highest; confirmed on a close below the neckline.",
    ),
    PatternSpec(
        "bullFlag",
        "Bull flag",
        "chart",
        "long",
        "Edwards & Magee ch. 11; Bulkowski 'Flags'",
        "A steep rise (pole), a shallow pause; confirmed on a close above the pause.",
    ),
    PatternSpec(
        "bearFlag",
        "Bear flag",
        "chart",
        "short",
        "Edwards & Magee ch. 11; Bulkowski 'Flags'",
        "A steep fall (pole), a shallow pause; confirmed on a close below the pause.",
    ),
    PatternSpec(
        "ascendingTriangle",
        "Ascending triangle",
        "chart",
        "long",
        "Edwards & Magee ch. 8; Bulkowski 'Triangles, Ascending'",
        "Flat resistance over rising lows; confirmed on a close above resistance.",
    ),
    PatternSpec(
        "descendingTriangle",
        "Descending triangle",
        "chart",
        "short",
        "Edwards & Magee ch. 8; Bulkowski 'Triangles, Descending'",
        "Flat support under falling highs; confirmed on a close below support.",
    ),
    PatternSpec(
        "symmetricalTriangle",
        "Symmetrical triangle",
        "chart",
        "either",
        "Edwards & Magee ch. 8; Bulkowski 'Triangles, Symmetrical'",
        "Falling highs and rising lows; confirmed on a close outside either line.",
    ),
    PatternSpec(
        "fallingWedge",
        "Falling wedge",
        "chart",
        "long",
        "Edwards & Magee ch. 10; Bulkowski 'Wedges, Falling'",
        "Two falling, converging lines; confirmed on a close above the upper line.",
    ),
    PatternSpec(
        "risingWedge",
        "Rising wedge",
        "chart",
        "short",
        "Edwards & Magee ch. 10; Bulkowski 'Wedges, Rising'",
        "Two rising, converging lines; confirmed on a close below the lower line.",
    ),
    # Candlestick patterns (shape from TA-Lib; trend context, size filter and plan are ours)
    PatternSpec(
        "bullishEngulfing",
        "Bullish engulfing",
        "candlestick",
        "long",
        "Nison ch. 4; TA-Lib CDLENGULFING",
        "An up candle whose body engulfs a down candle's.",
    ),
    PatternSpec(
        "bearishEngulfing",
        "Bearish engulfing",
        "candlestick",
        "short",
        "Nison ch. 4; TA-Lib CDLENGULFING",
        "A down candle whose body engulfs an up candle's.",
    ),
    PatternSpec(
        "hammer",
        "Hammer",
        "candlestick",
        "long",
        "Nison ch. 4; TA-Lib CDLHAMMER",
        "Small body at the top, long lower shadow, after a decline.",
    ),
    PatternSpec(
        "hangingMan",
        "Hanging man",
        "candlestick",
        "short",
        "Nison ch. 4; TA-Lib CDLHANGINGMAN",
        "Hammer shape after a rise.",
    ),
    PatternSpec(
        "invertedHammer",
        "Inverted hammer",
        "candlestick",
        "long",
        "Nison ch. 5; TA-Lib CDLINVERTEDHAMMER",
        "Small body at the bottom, long upper shadow, after a decline.",
    ),
    PatternSpec(
        "shootingStar",
        "Shooting star",
        "candlestick",
        "short",
        "Nison ch. 5; TA-Lib CDLSHOOTINGSTAR",
        "Inverted-hammer shape after a rise.",
    ),
    PatternSpec(
        "morningStar",
        "Morning star",
        "candlestick",
        "long",
        "Nison ch. 5; TA-Lib CDLMORNINGSTAR",
        "Long down candle, small star, long up candle closing into the first body.",
    ),
    PatternSpec(
        "eveningStar",
        "Evening star",
        "candlestick",
        "short",
        "Nison ch. 5; TA-Lib CDLEVENINGSTAR",
        "Long up candle, small star, long down candle closing into the first body.",
    ),
    PatternSpec(
        "bullishHarami",
        "Bullish harami",
        "candlestick",
        "long",
        "Nison ch. 6; TA-Lib CDLHARAMI",
        "A small body inside the prior long down body, after a decline.",
    ),
    PatternSpec(
        "bearishHarami",
        "Bearish harami",
        "candlestick",
        "short",
        "Nison ch. 6; TA-Lib CDLHARAMI",
        "A small body inside the prior long up body, after a rise.",
    ),
)

SPECS: dict[str, PatternSpec] = {p.id: p for p in CATALOG}
PATTERN_IDS: tuple[str, ...] = tuple(p.id for p in CATALOG)
