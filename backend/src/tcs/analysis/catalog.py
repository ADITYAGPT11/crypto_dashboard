"""The pattern catalogue: every setup the rules can confirm, with its source.

Definitions follow the standard references; where crypto's 24/7 market forces a
change (no session gaps), the deviation is written down in ``docs/product/patterns.md``.

- Bulkowski, *Encyclopedia of Chart Patterns* (3rd ed., 2021)
- Edwards & Magee, *Technical Analysis of Stock Trends* (11th ed.)
- Nison, *Japanese Candlestick Charting Techniques* (2nd ed.)
- StockCharts ChartSchool, candlestick reversal patterns (trend and confirmation guidelines)
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

#: Bump when ANY detector, location or checklist rule or threshold changes.
RULESET_VERSION = "2026.11-r13"

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
        "either",
        "Edwards & Magee ch. 8; Bulkowski 'Triangles, Ascending'",
        "Flat resistance over rising lows; confirmed on a close outside either line (usually up).",
    ),
    PatternSpec(
        "descendingTriangle",
        "Descending triangle",
        "chart",
        "either",
        "Edwards & Magee ch. 8; Bulkowski 'Triangles, Descending'",
        "Flat support under falling highs; confirmed on a close outside either line (usually down).",
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
        "either",
        "Edwards & Magee ch. 10; Bulkowski 'Wedges, Falling'",
        "Two falling, converging lines; confirmed on a close outside either line (usually up).",
    ),
    PatternSpec(
        "risingWedge",
        "Rising wedge",
        "chart",
        "either",
        "Edwards & Magee ch. 10; Bulkowski 'Wedges, Rising'",
        "Two rising, converging lines; confirmed on a close outside either line (usually down).",
    ),
    # Added in r13 (Bulkowski's rankings and crypto usage; docs/product/patterns.md)
    PatternSpec(
        "tripleBottom",
        "Triple bottom",
        "chart",
        "long",
        "Bulkowski 'Triple Bottoms'",
        "Three similar swing lows; confirmed on a close above the higher peak between them.",
    ),
    PatternSpec(
        "tripleTop",
        "Triple top",
        "chart",
        "short",
        "Bulkowski 'Triple Tops'",
        "Three similar swing highs; confirmed on a close below the lower trough between them.",
    ),
    PatternSpec(
        "bullPennant",
        "Bull pennant",
        "chart",
        "long",
        "Edwards & Magee ch. 11; Bulkowski 'Pennants'",
        "A steep rise, a short pause between converging lines; confirmed on a close above it.",
    ),
    PatternSpec(
        "bearPennant",
        "Bear pennant",
        "chart",
        "short",
        "Edwards & Magee ch. 11; Bulkowski 'Pennants'",
        "A steep fall, a short pause between converging lines; confirmed on a close below it.",
    ),
    PatternSpec(
        "rectangle",
        "Rectangle",
        "chart",
        "either",
        "Edwards & Magee ch. 9; Bulkowski 'Rectangles'",
        "Two flat, parallel lines (a range); confirmed on a close outside either line.",
    ),
    PatternSpec(
        "risingChannel",
        "Rising channel",
        "chart",
        "either",
        "Bulkowski 'Channels'",
        "Two rising, parallel lines; confirmed on a close outside either line.",
    ),
    PatternSpec(
        "fallingChannel",
        "Falling channel",
        "chart",
        "either",
        "Bulkowski 'Channels'",
        "Two falling, parallel lines; confirmed on a close outside either line.",
    ),
    PatternSpec(
        "cupWithHandle",
        "Cup with handle",
        "chart",
        "long",
        "Bulkowski 'Cup with Handle'; O'Neil",
        "A rounded cup between two rims and a shallow handle; confirmed on a close above the right rim.",
    ),
    PatternSpec(
        "invertedCupWithHandle",
        "Inverted cup with handle",
        "chart",
        "short",
        "Bulkowski 'Cup with Handle, Inverted'",
        "An upside-down cup and handle; confirmed on a close below the right rim.",
    ),
    PatternSpec(
        "bullishSweep",
        "Bullish liquidity sweep",
        "chart",
        "long",
        "ICT / smart-money concepts (swing failure)",
        "A wick below an obvious swing low that closes back above it.",
    ),
    PatternSpec(
        "bearishSweep",
        "Bearish liquidity sweep",
        "chart",
        "short",
        "ICT / smart-money concepts (swing failure)",
        "A wick above an obvious swing high that closes back below it.",
    ),
    # Candlestick patterns (in-house, candlesticks.py: shape, trend, confirmation, plan)
    PatternSpec(
        "bullishEngulfing",
        "Bullish engulfing",
        "candlestick",
        "long",
        "Nison ch. 4; StockCharts",
        "An up candle whose body engulfs a down candle's.",
    ),
    PatternSpec(
        "bearishEngulfing",
        "Bearish engulfing",
        "candlestick",
        "short",
        "Nison ch. 4; StockCharts",
        "A down candle whose body engulfs an up candle's.",
    ),
    PatternSpec(
        "hammer",
        "Hammer",
        "candlestick",
        "long",
        "Nison ch. 4; StockCharts",
        "Lower shadow at least twice the body, almost no upper shadow.",
    ),
    PatternSpec(
        "hangingMan",
        "Hanging man",
        "candlestick",
        "short",
        "Nison ch. 4; StockCharts",
        "Lower shadow at least twice the body, almost no upper shadow.",
    ),
    PatternSpec(
        "invertedHammer",
        "Inverted hammer",
        "candlestick",
        "long",
        "Nison ch. 5; StockCharts",
        "Upper shadow at least twice the body, almost no lower shadow.",
    ),
    PatternSpec(
        "shootingStar",
        "Shooting star",
        "candlestick",
        "short",
        "Nison ch. 5; StockCharts",
        "Upper shadow at least twice the body, almost no lower shadow.",
    ),
    PatternSpec(
        "morningStar",
        "Morning star",
        "candlestick",
        "long",
        "Nison ch. 5; StockCharts",
        "Long down candle, small star below its body, long up candle closing past its middle.",
    ),
    PatternSpec(
        "eveningStar",
        "Evening star",
        "candlestick",
        "short",
        "Nison ch. 5; StockCharts",
        "Long up candle, small star above its body, long down candle closing past its middle.",
    ),
    PatternSpec(
        "bullishHarami",
        "Bullish harami",
        "candlestick",
        "long",
        "Nison ch. 6; StockCharts",
        "A small body inside the prior long down body.",
    ),
    PatternSpec(
        "bearishHarami",
        "Bearish harami",
        "candlestick",
        "short",
        "Nison ch. 6; StockCharts",
        "A small body inside the prior long up body.",
    ),
)

SPECS: dict[str, PatternSpec] = {p.id: p for p in CATALOG}
PATTERN_IDS: tuple[str, ...] = tuple(p.id for p in CATALOG)
