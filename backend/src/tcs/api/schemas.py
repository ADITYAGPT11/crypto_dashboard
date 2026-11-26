"""Response models. JSON is camelCase for the TypeScript client (``src/api/schema.ts`` is
generated from the OpenAPI document these produce: ``npm run api:types``)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class Out(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class PointOut(Out):
    time: int
    price: float
    label: str


class LineOut(Out):
    a: PointOut
    b: PointOut
    label: str


class CheckOut(Out):
    """One item of the setup checklist (``analysis/checklist.py``)."""

    id: Literal["location", "rsi", "volume", "vwap", "atr", "supertrend"]
    label: str
    passed: bool
    #: What was observed, e.g. "RSI 63" or "volume 2.1x average".
    detail: str


class OccurrenceOut(Out):
    pattern: str
    direction: Literal["long", "short"]
    location: Literal["confluence", "zone", "orderBlock", "openSpace"]
    #: Open time of the confirmation candle (the pattern exists at its close).
    time: int
    start_time: int
    #: Close of the confirmation candle.
    close: float
    extreme: float
    points: list[PointOut]
    lines: list[LineOut]
    #: Checklist items passed, 0 to ``CatalogOut.max_score`` (an observation, not a probability).
    score: int
    checks: list[CheckOut]
    #: Volume trend while a flag, triangle or wedge formed; information, not a check.
    formation_volume: Literal["falling", "rising"] | None = None


class ZoneOut(Out):
    kind: Literal["demand", "supply"]
    low: float
    high: float
    start_time: int
    formed_time: int
    end_time: int | None
    tests: int
    held: int
    departure_atr: float


class OrderBlockOut(Out):
    kind: Literal["bullish", "bearish"]
    low: float
    high: float
    time: int
    formed_time: int
    end_time: int | None
    mitigated_time: int | None
    broke: float


class FvgOut(Out):
    kind: Literal["bullish", "bearish"]
    low: float
    high: float
    time: int
    formed_time: int
    filled_time: int | None


class StructureOut(Out):
    kind: Literal["bos", "choch"]
    direction: Literal["up", "down"]
    level: float
    swing_time: int
    time: int


class CoverageOut(Out):
    first: int | None
    last: int | None
    count: int
    expected_last: int
    #: Closed candles the source has not delivered yet (0 = up to date).
    behind: int
    gaps: int
    rest_ok: bool


class AnalysisOut(Out):
    symbol: str
    tf: str
    zone_tf: str
    ruleset: str
    coverage: CoverageOut
    zone_coverage: CoverageOut
    occurrences: list[OccurrenceOut]
    zones: list[ZoneOut]
    order_blocks: list[OrderBlockOut]
    fvgs: list[FvgOut]
    structure: list[StructureOut]


class ScannerItemOut(Out):
    symbol: str
    occurrence: OccurrenceOut


class ScannerOut(Out):
    ruleset: str
    tf: str
    zone_tf: str
    bars: int
    items: list[ScannerItemOut]
    failed: list[str]


class PatternOut(Out):
    id: str
    label: str
    kind: Literal["chart", "candlestick"]
    bias: Literal["long", "short", "either"]
    source: str
    summary: str


class CatalogOut(Out):
    ruleset: str
    patterns: list[PatternOut]
    #: Number of items in the setup checklist (the score's maximum).
    max_score: int
    timeframes: list[str]
    universe: list[str]


class CandlesOut(Out):
    symbol: str
    tf: str
    #: [open time, open, high, low, close, volume, taker buy volume (null: unknown)], closed
    #: candles, ascending. Taker buy is base volume bought by aggressive buyers (delta, CVD).
    candles: list[tuple[int, float, float, float, float, float, float | None]]
    coverage: CoverageOut


class HealthOut(Out):
    ok: bool
    ruleset: str


class DepthFeedOut(Out):
    state: Literal["connecting", "live", "down"]
    error: str | None
    #: Price levels in the synced book.
    levels: int
    #: When the feed last became live (ms), or null.
    since: int | None


class DepthColumnOut(Out):
    """Average resting notional (quote currency) per price bucket over one minute."""

    #: Minute open time, ms.
    time: int
    bucket: float
    mid: float
    samples: int
    #: [bucket index (price = index x bucket), notional], bids and asks apart.
    bids: list[tuple[int, float]]
    asks: list[tuple[int, float]]


class DepthOut(Out):
    symbol: str
    #: The analysis service is recording this symbol now.
    recording: bool
    #: Every symbol being recorded.
    symbols: list[str]
    retention_days: int
    feeds: dict[str, DepthFeedOut]
    columns: list[DepthColumnOut]
