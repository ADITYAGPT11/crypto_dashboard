"""FastAPI app: ``/api/v1/...``. Read-only market analysis; no orders, no keys."""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import AsyncGenerator
from concurrent.futures import ProcessPoolExecutor
from typing import Annotated

from fastapi import APIRouter, FastAPI, HTTPException, Query

from tcs.analysis.catalog import PATTERN_IDS, RULESET_VERSION
from tcs.analysis.types import LOCATIONS
from tcs.api import convert
from tcs.api.schemas import (
    AnalysisOut,
    CandlesOut,
    CatalogOut,
    HealthOut,
    ScannerOut,
    SetupDetailOut,
    StatsOut,
)
from tcs.api.service import BadRequest, Service, now_ms
from tcs.common.timeframes import TF_MS, Timeframe, last_closed_open, parse_timeframe
from tcs.common.universe import is_canonical
from tcs.config import Settings
from tcs.jobs.stats_job import STATS_TFS, run_stats

log = logging.getLogger(__name__)
#: How often the scheduler looks for statistics that need a new run.
SCHEDULE_EVERY_S = 300


def _tf(value: str) -> Timeframe:
    try:
        return parse_timeframe(value)
    except ValueError as err:
        raise HTTPException(422, str(err)) from err


def _symbol(value: str) -> str:
    s = value.upper()
    if not is_canonical(s):
        raise HTTPException(422, "symbol must be BASE-QUOTE, e.g. BTC-USDT")
    return s


def _stale(svc: Service, tf: Timeframe, now: int) -> bool:
    """A run is due when none exists for this ruleset or a newer candle closed since it ended."""
    run = svc.store.run(RULESET_VERSION, tf)
    if run is None:
        return True
    if run["status"] == "running":
        return False
    finished = run["finished_at"] or 0
    if run["status"] == "failed":
        return now - finished > 3_600_000
    return (
        last_closed_open(now, tf) + TF_MS[tf] > finished + TF_MS[tf] and now - finished >= TF_MS[tf]
    )


async def _scheduler(svc: Service, pool: ProcessPoolExecutor) -> None:
    loop = asyncio.get_running_loop()
    while True:
        for tf in STATS_TFS:
            if _stale(svc, tf, now_ms()):
                log.info("statistics run for %s starting", tf)
                try:
                    await loop.run_in_executor(pool, run_stats, svc.settings, tf)
                except Exception:
                    log.exception("statistics run for %s failed", tf)
        await asyncio.sleep(SCHEDULE_EVERY_S)


def create_app(settings: Settings | None = None, service: Service | None = None) -> FastAPI:
    settings = settings or Settings()
    svc = service or Service(settings)

    @contextlib.asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncGenerator[None]:
        # Interrupted runs (process killed) restart from scratch.
        for tf in STATS_TFS:
            r = svc.store.run(RULESET_VERSION, tf)
            if r and r["status"] == "running":
                svc.store.finish_run(RULESET_VERSION, tf, now_ms(), "failed", r["meta"])
        task: asyncio.Task[None] | None = None
        pool: ProcessPoolExecutor | None = None
        if settings.schedule:
            pool = ProcessPoolExecutor(max_workers=1)
            task = asyncio.create_task(_scheduler(svc, pool))
        try:
            yield
        finally:
            if task:
                task.cancel()
            if pool:
                pool.shutdown(wait=False, cancel_futures=True)

    app = FastAPI(
        title="GreenMTM analysis API",
        version="0.1.0",
        description="Pattern detection, demand/supply zones, order blocks and setup statistics. "
        "Read-only: the system confirms, a human trades.",
        lifespan=lifespan,
    )
    r = APIRouter(prefix="/api/v1")

    @r.get("/health")
    def health() -> HealthOut:
        return HealthOut(
            ok=True,
            ruleset=RULESET_VERSION,
            runs={tf: convert.run(svc.store.run(RULESET_VERSION, tf)) for tf in STATS_TFS},
        )

    @r.get("/patterns")
    def patterns() -> CatalogOut:
        return svc.catalog()

    @r.get("/candles/{symbol}")
    def candles(
        symbol: str, tf: str = "4h", limit: Annotated[int, Query(ge=50, le=5000)] = 3000
    ) -> CandlesOut:
        return svc.candles(_symbol(symbol), _tf(tf), limit)

    @r.get("/analysis/{symbol}")
    def analysis(
        symbol: str,
        tf: str = "4h",
        zone_tf: Annotated[str | None, Query(alias="zoneTf")] = None,
        limit: Annotated[int, Query(ge=100, le=5000)] = 3000,
    ) -> AnalysisOut:
        t = _tf(tf)
        try:
            return svc.analysis(_symbol(symbol), t, _tf(zone_tf) if zone_tf else t, limit)
        except BadRequest as err:
            raise HTTPException(422, str(err)) from err

    @r.get("/stats")
    def stats(
        tf: str = "4h", zone_tf: Annotated[str | None, Query(alias="zoneTf")] = None
    ) -> StatsOut:
        t = _tf(tf)
        return svc.stats(t, _tf(zone_tf) if zone_tf else t)

    @r.get("/stats/setup")
    def setup(
        pattern: str,
        direction: str,
        tf: str = "4h",
        zone_tf: Annotated[str | None, Query(alias="zoneTf")] = None,
        location: str = "*",
    ) -> SetupDetailOut:
        if pattern not in PATTERN_IDS:
            raise HTTPException(422, f"unknown pattern {pattern!r}")
        if location != "*" and location not in LOCATIONS:
            raise HTTPException(422, f"unknown location {location!r}")
        t = _tf(tf)
        try:
            return svc.setup(t, _tf(zone_tf) if zone_tf else t, pattern, direction, location)
        except BadRequest as err:
            raise HTTPException(422, str(err)) from err

    @r.post("/stats/run")
    async def run_now(tf: str = "4h") -> dict[str, str]:
        t = _tf(tf)
        if t not in STATS_TFS:
            raise HTTPException(422, f"statistics run on {', '.join(STATS_TFS)}")
        loop = asyncio.get_running_loop()
        loop.run_in_executor(None, run_stats, settings, t)
        return {"status": "started", "tf": t}

    @r.get("/scanner")
    def scanner(
        tf: str = "4h",
        zone_tf: Annotated[str | None, Query(alias="zoneTf")] = None,
        symbols: str = "",
        bars: Annotated[int, Query(ge=1, le=20)] = 3,
    ) -> ScannerOut:
        t = _tf(tf)
        extra = [_symbol(s) for s in symbols.split(",") if s.strip()][:30]
        universe = list(dict.fromkeys([*extra, *settings.universe]))
        try:
            return svc.scanner(t, _tf(zone_tf) if zone_tf else t, universe, bars)
        except BadRequest as err:
            raise HTTPException(422, str(err)) from err

    app.include_router(r)
    return app
