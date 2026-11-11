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


class OutcomeOut(Out):
    result: Literal["win", "loss", "expired", "open"]
    exit_time: int | None
    move_pct: float
    r: float
    bars: int


class OccurrenceOut(Out):
    pattern: str
    direction: Literal["long", "short"]
    location: Literal["confluence", "zone", "orderBlock", "openSpace"]
    #: Open time of the confirmation candle (the signal exists at its close).
    time: int
    start_time: int
    entry: float
    stop: float
    target: float
    extreme: float
    points: list[PointOut]
    lines: list[LineOut]
    outcome: OutcomeOut


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


class SummaryOut(Out):
    n: int
    wins: int
    losses: int
    expired: int
    open: int = 0
    win_rate: float
    ci_low: float
    ci_high: float
    break_even: float
    avg_win_pct: float
    avg_loss_pct: float
    expectancy_r: float
    median_bars: float
    verdict: Literal["edge", "noEdge", "tooFew"]


class SetupStatOut(Out):
    pattern: str
    direction: Literal["long", "short"]
    #: A location, or "*" for every location together (the pattern's baseline).
    location: str
    summary: SummaryOut


class RunOut(Out):
    status: Literal["running", "done", "failed"]
    started_at: int
    finished_at: int | None
    coins: list[str]
    done: int
    failed: list[str]
    since: int
    until: int | None
    candles: int
    days: int


class StatsOut(Out):
    ruleset: str
    tf: str
    zone_tf: str
    run: RunOut | None
    setups: list[SetupStatOut]


class CaseOut(Out):
    symbol: str
    location: str
    time: int
    result: Literal["win", "loss"]
    entry: float
    stop: float
    target: float
    move_pct: float
    r: float
    bars: int
    exit_time: int | None


class CoinSummaryOut(Out):
    symbol: str
    summary: SummaryOut


class SetupDetailOut(Out):
    ruleset: str
    tf: str
    zone_tf: str
    pattern: str
    direction: Literal["long", "short"]
    location: str
    pooled: SummaryOut | None
    per_coin: list[CoinSummaryOut]
    recent: list[CaseOut]


class ScannerItemOut(Out):
    symbol: str
    occurrence: OccurrenceOut
    pooled: SummaryOut | None
    own: SummaryOut | None


class ScannerOut(Out):
    ruleset: str
    tf: str
    zone_tf: str
    bars: int
    items: list[ScannerItemOut]
    failed: list[str]
    run: RunOut | None


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
    max_hold_bars: int
    min_sample: int
    timeframes: list[str]
    universe: list[str]


class CandlesOut(Out):
    symbol: str
    tf: str
    #: [open time, open, high, low, close, volume], closed candles, ascending.
    candles: list[tuple[int, float, float, float, float, float]]
    coverage: CoverageOut


class HealthOut(Out):
    ok: bool
    ruleset: str
    runs: dict[str, RunOut | None]
