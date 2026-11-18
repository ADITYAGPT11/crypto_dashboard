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
    #: Order-flow context the records are restricted to ("*" = every case).
    context: str = "*"
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
    delta_ratio: float | None = None
    flow: Literal["confirms", "against", "neutral"] | None = None
    cvd_divergence: bool | None = None


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


class RSummaryOut(Out):
    """A playbook variant's record: R per trade after costs, with 95% ranges."""

    n: int
    wins: int
    win_rate: float
    ci_low: float
    ci_high: float
    mean_r: float
    mean_r_low: float
    mean_r_high: float
    mean_gross_r: float
    avg_win_r: float
    avg_loss_r: float
    profit_factor: float
    median_bars: float
    baseline_n: int
    baseline_mean_r: float
    edge_vs_random: float
    edge_vs_random_low: float
    edge_vs_random_high: float
    verdict: Literal["edge", "noEdge", "tooFew"]


class PlaybookVariantOut(Out):
    entry: Literal["market", "fib", "fvg"]
    exit: Literal["target", "trail", "managed"]
    #: Whole period, then split in time: first 70% ("in") and the latest 30% ("out").
    all: RSummaryOut | None
    in_sample: RSummaryOut | None
    out_of_sample: RSummaryOut | None


class PlaybookParamsOut(Out):
    trigger_bars: int
    entry_bars: int
    stop_atr: float
    max_risk_htf_atr: float
    #: Minimum stop distance, percent of the price (trades with a tighter stop are skipped).
    min_stop_pct: float
    #: Timeframe of the zones and order blocks a trigger must be at.
    level_tf: str
    fib_level: float
    max_hold_bars: int
    breakeven_r: float
    partial_r: float
    partial_share: float
    maker: float
    taker: float
    slippage: float


class PlaybookStatsOut(Out):
    ruleset: str
    htf: str
    ltf: str
    run: RunOut | None
    #: Time (ms) splitting the in-sample and out-of-sample segments, or null before a run.
    split: int | None
    params: PlaybookParamsOut
    variants: list[PlaybookVariantOut]


class PlaybookTradeOut(Out):
    entry_kind: Literal["market", "fib", "fvg"]
    exit_kind: Literal["target", "trail", "managed"]
    status: Literal["pending", "skipped", "cancelled", "open", "closed"]
    note: str
    entry: float | None
    stop: float | None
    target: float | None
    fill_time: int | None
    exit_time: int | None
    exit_price: float | None
    reason: Literal["stop", "target", "trail", "breakeven", "time"] | None
    #: Where the stop is now (open trades: after breakeven / trailing).
    stop_now: float | None
    r_net: float
    r_gross: float = 0.0


class PlaybookTriggerOut(Out):
    pattern: str
    direction: Literal["long", "short"]
    location: Literal["confluence", "zone", "orderBlock", "openSpace"]
    #: Open time of the HTF confirmation candle; the trigger is known at its close.
    time: int
    known_at: int
    window_end: int
    stage: Literal["waiting", "confirmed", "expired", "invalidated"]
    htf_stop: float
    htf_target: float
    choch_time: int | None
    broke: float | None
    impulse_low: float | None
    impulse_high: float | None
    trades: list[PlaybookTradeOut]


class PlaybookLiveOut(Out):
    symbol: str
    htf: str
    ltf: str
    ruleset: str
    coverage: CoverageOut
    ltf_coverage: CoverageOut
    #: Most recent first.
    triggers: list[PlaybookTriggerOut]


class PaperTradeOut(Out):
    """One measured playbook trade, for replaying in a paper (dummy-money) account."""

    symbol: str
    pattern: str
    direction: Literal["long", "short"]
    location: str
    #: Open time of the HTF setup candle.
    time: int
    entry_price: float
    stop: float
    exit_price: float | None
    reason: Literal["stop", "target", "trail", "breakeven", "time"] | None
    #: Result in R after costs, and before costs (the gap is fees and slippage).
    r_net: float
    r_gross: float
    fill_time: int | None
    exit_time: int | None


class PlaybookTradesOut(Out):
    ruleset: str
    htf: str
    ltf: str
    entry: Literal["market", "fib", "fvg"]
    exit: Literal["target", "trail", "managed"]
    run: RunOut | None
    #: Oldest first by fill time.
    trades: list[PaperTradeOut]


class ForwardTradeOut(Out):
    """A playbook trade recorded live, as it happened (forward paper trading)."""

    symbol: str
    #: Open time of the HTF setup candle.
    time: int
    pattern: str
    direction: Literal["long", "short"]
    location: str
    status: Literal["pending", "skipped", "cancelled", "open", "closed"]
    note: str = ""
    entry_price: float | None
    stop: float | None
    target: float | None
    fill_time: int | None
    exit_time: int | None
    exit_price: float | None
    reason: Literal["stop", "target", "trail", "breakeven", "time"] | None
    stop_now: float | None
    r_net: float
    r_gross: float
    #: When the system first recorded this trade, and whether that was after its entry had
    #: already happened (the server was off: a trader could not have acted in time).
    first_seen: int
    late: bool


class ForwardOut(Out):
    ruleset: str
    htf: str
    ltf: str
    entry: Literal["market", "fib", "fvg"]
    exit: Literal["target", "trail", "managed"]
    #: Forward tracking of this rule set began here; only setups known after it count.
    started_at: int | None
    last_run: int | None
    #: Setups at a level seen since the start (all variants share them).
    signals: int
    coins: list[str]
    failed: list[str]
    #: Oldest first.
    trades: list[ForwardTradeOut]
