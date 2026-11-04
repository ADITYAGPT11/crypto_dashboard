"""Response models (published in the OpenAPI schema; the frontend mirrors them)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from tcs.research.patterns.catalog import Bias, Kind
from tcs.research.patterns.outcome import Result
from tcs.research.patterns.stats import Verdict

Direction = Literal["bullish", "bearish"]


class PatternInfoOut(BaseModel):
    name: str
    label: str
    kind: Kind
    bias: Bias


class BracketOut(BaseModel):
    stop_atr: float
    target_atr: float
    max_bars: int
    break_even: float = Field(description="Win rate needed to break even at this bracket")


class OutcomeOut(BaseModel):
    result: Result
    exit_time: int | None = Field(description="Open time (ms) of the candle that hit stop/target")
    bars: int
    r: float
    move_pct: float


class EventOut(BaseModel):
    pattern: str
    label: str
    kind: Kind
    direction: Direction
    open_time: int = Field(description="Open time (ms) of the candle that completed the pattern")
    entry: float
    stop: float
    target: float
    atr: float
    outcome: OutcomeOut


class PatternsOut(BaseModel):
    symbol: str
    interval: str
    candles: int
    last_open_time: int | None
    bracket: BracketOut
    current: list[EventOut] = Field(description="Completed on the last `recent_bars` candles")
    events: list[EventOut] = Field(description="Completed in the last `since_bars` candles")


class ForwardOut(BaseModel):
    horizon: int
    n: int
    mean_pct: float
    median_pct: float
    positive_rate: float


class StatsOut(BaseModel):
    n: int = Field(description="Resolved cases: wins + losses")
    wins: int
    losses: int
    expired: int
    open: int
    win_rate: float
    ci_low: float = Field(description="Wilson 95% interval, low end")
    ci_high: float
    ci_low_adjusted: float = Field(
        description="Wilson low end Bonferroni-corrected for `tests` patterns; the verdict uses it"
    )
    tests: int = Field(description="Pattern x direction combinations tested together")
    break_even: float
    avg_win_pct: float
    avg_loss_pct: float
    expectancy_r: float
    median_bars: float
    verdict: Verdict
    forward: list[ForwardOut]


class PatternStatsOut(BaseModel):
    pattern: str
    label: str
    kind: Kind
    direction: Direction
    own: StatsOut = Field(description="This symbol only")
    pooled: StatsOut = Field(description="This symbol + the research universe")
    recent: list[EventOut] = Field(description="Latest occurrences on this symbol, newest first")


class StatsResponse(BaseModel):
    symbol: str
    interval: str
    bracket: BracketOut
    symbols: list[str] = Field(description="Symbols pooled")
    unavailable: list[str] = Field(description="Symbols whose history failed to load")
    stats: list[PatternStatsOut]
