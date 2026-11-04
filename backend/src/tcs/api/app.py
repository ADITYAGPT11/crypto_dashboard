"""FastAPI app: pattern detection on a coin and the past performance of each pattern."""

from __future__ import annotations

from collections.abc import AsyncIterator, Awaitable
from contextlib import asynccontextmanager
from dataclasses import asdict
from typing import Annotated

import httpx
from fastapi import FastAPI, HTTPException, Query

from tcs.api.schemas import (
    BracketOut,
    EventOut,
    ForwardOut,
    OutcomeOut,
    PatternInfoOut,
    PatternsOut,
    PatternStatsOut,
    StatsOut,
    StatsResponse,
)
from tcs.common.symbols import normalize_symbol, validate_interval
from tcs.marketdata.binance_history import BinanceHistory, HistorySource
from tcs.research.patterns.catalog import KINDS, Kind, catalog
from tcs.research.patterns.outcome import BracketParams
from tcs.research.patterns.service import Occurrence, PatternResearch, stats_of
from tcs.research.patterns.stats import PatternStats

KindsQuery = Annotated[
    str, Query(description="Comma-separated: chart, candlestick", pattern=r"^[a-z,]+$")
]
StopQuery = Annotated[float, Query(gt=0, le=10, description="Stop distance in ATR")]
TargetQuery = Annotated[float, Query(gt=0, le=20, description="Target distance in ATR")]
MaxBarsQuery = Annotated[int, Query(ge=1, le=500, description="Candles before a trade expires")]


def _kinds(raw: str) -> tuple[Kind, ...]:
    asked = {k.strip() for k in raw.split(",") if k.strip()}
    bad = asked - set(KINDS)
    if bad or not asked:
        raise HTTPException(422, f"kinds must be from {', '.join(KINDS)}")
    return tuple(k for k in KINDS if k in asked)


def _symbol_interval(symbol: str, interval: str) -> tuple[str, str]:
    try:
        return normalize_symbol(symbol), validate_interval(interval)
    except ValueError as err:
        raise HTTPException(422, str(err)) from err


def _bracket(p: BracketParams) -> BracketOut:
    return BracketOut(
        stop_atr=p.stop_atr,
        target_atr=p.target_atr,
        max_bars=p.max_bars,
        break_even=1 / (1 + p.reward_r),
    )


def _event(o: Occurrence, open_times: dict[str, list[int]] | None = None) -> EventOut:
    info = catalog()[o.event.pattern]
    out = o.outcome
    exit_time = None
    if out.exit_index is not None and open_times is not None and o.symbol in open_times:
        exit_time = open_times[o.symbol][out.exit_index]
    return EventOut(
        pattern=info.name,
        label=info.label,
        kind=info.kind,
        direction="bullish" if o.event.direction > 0 else "bearish",
        open_time=o.open_time,
        entry=out.entry,
        stop=out.stop,
        target=out.target,
        atr=out.atr,
        outcome=OutcomeOut(
            result=out.result,
            exit_time=exit_time,
            bars=out.bars,
            r=out.r,
            move_pct=out.move_pct,
        ),
    )


def _stats(s: PatternStats) -> StatsOut:
    d = asdict(s)
    d["forward"] = [ForwardOut(**f) for f in d["forward"]]
    return StatsOut(**d)


async def _upstream[T](coro: Awaitable[T]) -> T:
    """Map history failures to 502 so the UI can say "unavailable" instead of crashing."""
    try:
        return await coro
    except httpx.HTTPError as err:
        raise HTTPException(502, f"history unavailable: {err}") from err


def create_app(history: HistorySource | None = None) -> FastAPI:
    source: HistorySource = history if history is not None else BinanceHistory()

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        yield
        if isinstance(source, BinanceHistory):
            await source.aclose()

    app = FastAPI(title="TCS backend", version="0.1.0", lifespan=lifespan)
    research = PatternResearch(source)

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/patterns/catalog")
    async def pattern_catalog() -> list[PatternInfoOut]:
        return [PatternInfoOut(**asdict(p)) for p in catalog().values()]

    @app.get("/patterns/{symbol}/{interval}")
    async def patterns(
        symbol: str,
        interval: str,
        kinds: KindsQuery = "chart",
        recent_bars: Annotated[int, Query(ge=1, le=50)] = 3,
        since_bars: Annotated[int, Query(ge=1, le=5000)] = 500,
        stop_atr: StopQuery = 1.0,
        target_atr: TargetQuery = 2.0,
        max_bars: MaxBarsQuery = 30,
    ) -> PatternsOut:
        """Patterns that completed on this coin's recent candles (closed candles only)."""
        sym, tf = _symbol_interval(symbol, interval)
        params = BracketParams(stop_atr, target_atr, max_bars)
        analysis, occ = await _upstream(research.occurrences(sym, tf, _kinds(kinds), params))
        c = analysis.candles
        n = len(c)
        times = {sym: c.open_time.tolist()}
        evs = [_event(o, times) for o in occ if o.event.index >= n - since_bars]
        return PatternsOut(
            symbol=sym,
            interval=tf,
            candles=n,
            last_open_time=int(c.open_time[-1]) if n else None,
            bracket=_bracket(params),
            current=[_event(o, times) for o in occ if o.event.index >= n - recent_bars],
            events=evs,
        )

    @app.get("/patterns/{symbol}/{interval}/stats")
    async def pattern_stats(
        symbol: str,
        interval: str,
        patterns: Annotated[
            str | None,
            Query(description="Comma-separated pattern names; omit for every pattern that fired"),
        ] = None,
        kinds: KindsQuery = "chart",
        stop_atr: StopQuery = 1.0,
        target_atr: TargetQuery = 2.0,
        max_bars: MaxBarsQuery = 30,
        recent: Annotated[int, Query(ge=0, le=100)] = 20,
    ) -> StatsResponse:
        """How each pattern performed before: on this coin and pooled across the universe."""
        sym, tf = _symbol_interval(symbol, interval)
        params = BracketParams(stop_atr, target_atr, max_bars)
        wanted = {p.strip() for p in patterns.split(",") if p.strip()} if patterns else None
        if wanted:
            unknown = wanted - set(catalog())
            if unknown:
                raise HTTPException(422, f"unknown patterns: {', '.join(sorted(unknown))}")
        res = await _upstream(research.pooled(sym, tf, _kinds(kinds), params))
        own_analysis = await research.analysis(sym, tf, _kinds(kinds))
        times = {sym: own_analysis.candles.open_time.tolist()}
        # Every pattern x direction we scanned is one test, whether or not the caller asked for it.
        tests = len(res.pooled)
        empty = stats_of([], tests)
        rows: list[PatternStatsOut] = []
        for (name, direction), pooled in sorted(res.pooled.items()):
            if wanted is not None and name not in wanted:
                continue
            info = catalog()[name]
            own = res.own.get((name, direction), [])
            latest = sorted(own, key=lambda o: o.open_time, reverse=True)[:recent]
            rows.append(
                PatternStatsOut(
                    pattern=name,
                    label=info.label,
                    kind=info.kind,
                    direction="bullish" if direction > 0 else "bearish",
                    own=_stats(stats_of(own, tests) if own else empty),
                    pooled=_stats(stats_of(pooled, tests)),
                    recent=[_event(o, times) for o in latest],
                )
            )
        return StatsResponse(
            symbol=sym,
            interval=tf,
            bracket=_bracket(params),
            symbols=list(res.symbols),
            unavailable=list(res.unavailable),
            stats=rows,
        )

    return app
