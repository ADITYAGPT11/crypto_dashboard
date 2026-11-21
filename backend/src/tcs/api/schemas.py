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


class StopOut(Out):
    #: Open time of the first candle this stop applies to.
    time: int
    price: float


class TrailOut(Out):
    """The setup exited with the trailing take-profit (``analysis/outcomes.py``)."""

    result: Literal["win", "loss", "expired", "open"]
    exit_time: int | None
    exit_price: float | None
    r: float
    bars: int
    #: Open time of the candle that first touched the target (trailing starts at its close).
    activated_time: int | None
    #: The stop each time it moved, starting with the original stop.
    stops: list[StopOut]


class FlowOut(Out):
    """Order flow when the setup confirmed (``analysis/flow.py``); nulls where unmeasurable."""

    #: Delta / volume over the last 3 candles, + = in the setup's direction.
    delta_ratio: float | None
    flow: Literal["confirms", "against", "neutral"] | None
    cvd_divergence: bool | None


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
    flow: FlowOut
    trail: TrailOut


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


class TrailSummaryOut(Out):
    """Trailing take-profit record. Wins, the range and the verdict are after costs."""

    n: int
    wins: int
    win_rate: float
    ci_low: float
    ci_high: float
    #: Mean R per trade before costs.
    expectancy_r: float
    #: Mean R per trade after fees, slippage and funding (0 in runs before r4).
    expectancy_net_r: float = 0.0
    #: 95% range of the net expectancy.
    exp_low: float | None
    exp_high: float | None
    avg_win_r: float
    avg_cost_r: float = 0.0
    median_bars: float
    verdict: Literal["edge", "noEdge", "tooFew"]


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
    #: Wilson low of the win rate against the break-even after costs.
    verdict: Literal["edge", "noEdge", "tooFew"]
    #: Mean R per resolved case after fees, slippage and funding.
    expectancy_net_r: float = 0.0
    #: Win rate needed to break even after costs (``break_even`` is before them).
    break_even_net: float = 0.5
    #: Mean cost per case in R.
    avg_cost_r: float = 0.0
    #: The same cases exited with the trailing take-profit (missing in older runs).
    trail: TrailSummaryOut | None = None


class SetupStatOut(Out):
    pattern: str
    direction: Literal["long", "short"]
    #: A location, or "*" for every location together (the pattern's baseline).
    location: str
    summary: SummaryOut


class CostsOut(Out):
    """The cost model every statistic of a run is measured after."""

    #: Exchange fee and slippage allowance per side, percent of notional.
    fee_pct: float
    slippage_pct: float
    round_trip_pct: float
    #: Last known funding event per coin (later holding time uses the last rate, estimated).
    funding_until: dict[str, int | None]


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
    #: Missing in runs before rule set r4 (statistics were gross then).
    costs: CostsOut | None = None


class StatsOut(Out):
    ruleset: str
    tf: str
    zone_tf: str
    run: RunOut | None
    #: Order-flow context the records are restricted to ("*" = every case).
    context: str = "*"
    setups: list[SetupStatOut]


class CaseOut(Out):
    symbol: str
    location: str
    time: int
    #: Expired = closed at the market after the holding limit (since rule set r5).
    result: Literal["win", "loss", "expired"]
    entry: float
    stop: float
    target: float
    move_pct: float
    r: float
    bars: int
    exit_time: int | None
    delta_ratio: float | None = None
    flow: Literal["confirms", "against", "neutral"] | None = None
    cvd_divergence: bool | None = None
    trail_result: Literal["win", "loss", "expired", "open"] | None = None
    trail_r: float | None = None
    trail_bars: int | None = None
    trail_exit_time: int | None = None
    #: Fees, slippage and funding of this case in R, and its R after them.
    cost_r: float | None = None
    net_r: float | None = None
    trail_net_r: float | None = None


class CoinSummaryOut(Out):
    symbol: str
    summary: SummaryOut


class ContextSummaryOut(Out):
    #: "delta:confirms" | "delta:against" | "delta:neutral" | "cvdDiv:yes" | "cvdDiv:no".
    context: str
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
    #: Pooled record split by order flow at confirmation, in display order.
    contexts: list[ContextSummaryOut]
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
    #: [open time, open, high, low, close, volume, taker buy volume (null: unknown)], closed
    #: candles, ascending. Taker buy is base volume bought by aggressive buyers (delta, CVD).
    candles: list[tuple[int, float, float, float, float, float, float | None]]
    coverage: CoverageOut


class HealthOut(Out):
    ok: bool
    ruleset: str
    runs: dict[str, RunOut | None]


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
