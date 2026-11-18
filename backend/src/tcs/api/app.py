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
from tcs.analysis.ingredients import INGREDIENTS_VERSION
from tcs.analysis.types import LOCATIONS
from tcs.api import convert
from tcs.api.schemas import (
    AnalysisOut,
    CandlesOut,
    CatalogOut,
    DepthColumnOut,
    DepthFeedOut,
    DepthOut,
    ForwardOut,
    HealthOut,
    IngredientsOut,
    PlaybookLiveOut,
    PlaybookStatsOut,
    PlaybookTradesOut,
    ScannerOut,
    SetupDetailOut,
    StatsOut,
)
from tcs.api.service import BadRequest, Service, now_ms
from tcs.common.timeframes import TF_MS, Timeframe, last_closed_open, parse_timeframe
from tcs.common.universe import is_canonical
from tcs.config import Settings
from tcs.depth.recorder import DepthRecorder
from tcs.jobs.ingredients_job import RUN_KEY as INGREDIENTS_RUN
from tcs.jobs.ingredients_job import run_ingredients
from tcs.jobs.playbook_job import PAIRS, pair_key, run_playbook_stats
from tcs.jobs.stats_job import STATS_TFS, run_stats

log = logging.getLogger(__name__)
#: How often the scheduler looks for statistics that need a new run.
SCHEDULE_EVERY_S = 300


def _tf(value: str) -> Timeframe:
    try:
        return parse_timeframe(value)
    except ValueError as err:
        raise HTTPException(422, str(err)) from err


def _pair(htf: str, ltf: str) -> tuple[Timeframe, Timeframe]:
    pair = (_tf(htf), _tf(ltf))
    if pair not in PAIRS:
        raise HTTPException(422, f"playbook pairs: {', '.join(pair_key(*p) for p in PAIRS)}")
    return pair


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


def _research_stale(svc: Service, now: int) -> bool:
    """The ingredient study reruns daily (or after a failure, hourly)."""
    run = svc.store.run(INGREDIENTS_VERSION, INGREDIENTS_RUN)
    if run is None:
        return True
    if run["status"] == "running":
        return False
    wait = 3_600_000 if run["status"] == "failed" else 86_400_000
    return now - (run["finished_at"] or 0) >= wait


def _playbook_stale(svc: Service, htf: Timeframe, now: int) -> bool:
    """Due when none exists for this ruleset, or one HTF candle after the last one finished."""
    pair = next(pair_key(h, lt) for h, lt in PAIRS if h == htf)
    run = svc.store.run(RULESET_VERSION, pair)
    if run is None:
        return True
    if run["status"] == "running":
        return False
    finished = run["finished_at"] or 0
    return now - finished >= (3_600_000 if run["status"] == "failed" else TF_MS[htf])


FORWARD_EVERY_S = 300


async def _forward_loop(svc: Service) -> None:
    """Forward paper trading: record the live playbook's trades every few minutes."""
    while True:
        for htf, ltf in PAIRS:
            try:
                r = await asyncio.to_thread(svc.record_forward, htf, ltf)
                if r["changed"]:
                    log.info("forward paper trades updated: %s", r)
            except Exception:
                log.exception("forward paper trading failed")
        await asyncio.sleep(FORWARD_EVERY_S)


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
        for htf, ltf in PAIRS:
            if _playbook_stale(svc, htf, now_ms()):
                log.info("playbook run for %s starting", pair_key(htf, ltf))
                try:
                    await loop.run_in_executor(pool, run_playbook_stats, svc.settings, htf, ltf)
                except Exception:
                    log.exception("playbook run for %s failed", pair_key(htf, ltf))
        if _research_stale(svc, now_ms()):
            log.info("ingredient study starting")
            try:
                await loop.run_in_executor(pool, run_ingredients, svc.settings)
            except Exception:
                log.exception("ingredient study failed")
        await asyncio.sleep(SCHEDULE_EVERY_S)


def create_app(
    settings: Settings | None = None,
    service: Service | None = None,
    recorder: DepthRecorder | None = None,
) -> FastAPI:
    settings = settings or Settings()
    svc = service or Service(settings)
    depth = recorder
    if depth is None and settings.record_depth:
        depth = DepthRecorder(svc.store, settings.depth_symbols, retention_days=settings.depth_days)

    @contextlib.asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncGenerator[None]:
        # Interrupted runs (process killed) restart from scratch.
        for version, key in [
            *((RULESET_VERSION, k) for k in STATS_TFS),
            *((RULESET_VERSION, pair_key(h, lt)) for h, lt in PAIRS),
            (INGREDIENTS_VERSION, INGREDIENTS_RUN),
        ]:
            r = svc.store.run(version, key)
            if r and r["status"] == "running":
                svc.store.finish_run(version, key, now_ms(), "failed", r["meta"])
        task: asyncio.Task[None] | None = None
        forward: asyncio.Task[None] | None = None
        pool: ProcessPoolExecutor | None = None
        if settings.schedule:
            pool = ProcessPoolExecutor(max_workers=1)
            task = asyncio.create_task(_scheduler(svc, pool))
        if settings.forward:
            forward = asyncio.create_task(_forward_loop(svc))
        if depth:
            await depth.start()
        try:
            yield
        finally:
            if depth:
                await depth.stop()
            if task:
                task.cancel()
            if forward:
                forward.cancel()
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

    @r.get("/depth/{symbol}")
    def depth_history(
        symbol: str, minutes: Annotated[int, Query(ge=1, le=7 * 1440)] = 360
    ) -> DepthOut:
        """Recorded order-book depth (one column per minute) for the heatmap.

        Asking for a symbol that is not recorded yet starts recording it (a few at most).
        """
        sym = _symbol(symbol)
        recording = depth.ensure(sym) if depth else False
        books = depth.books.get(sym) if depth else None
        cols = svc.store.depth(sym, now_ms() - minutes * 60_000)
        return DepthOut(
            symbol=sym,
            recording=recording,
            symbols=depth.recorded() if depth else [],
            retention_days=settings.depth_days,
            feeds={
                ex: DepthFeedOut(state=f.state, error=f.error, levels=f.levels, since=f.since)
                for ex, f in (books.feeds.items() if books else [])
            },
            columns=[
                DepthColumnOut(
                    time=c.time,
                    bucket=c.bucket,
                    mid=c.mid,
                    samples=c.samples,
                    bids=sorted(c.bids.items()),
                    asks=sorted(c.asks.items()),
                )
                for c in cols
            ],
        )

    @r.get("/playbook/stats")
    def playbook_stats(htf: str = "4h", ltf: str = "15m") -> PlaybookStatsOut:
        h, lt = _pair(htf, ltf)
        return svc.playbook_stats(h, lt)

    @r.get("/playbook/trades")
    def playbook_trades(
        entry: str, exit: str, htf: str = "4h", ltf: str = "15m"
    ) -> PlaybookTradesOut:
        """Every measured trade of one variant, oldest first, to replay in a paper account."""
        h, lt = _pair(htf, ltf)
        try:
            return svc.playbook_trades(h, lt, entry, exit)
        except BadRequest as err:
            raise HTTPException(422, str(err)) from err

    @r.get("/research/ingredients")
    def research_ingredients() -> IngredientsOut:
        """Does any single ingredient predict direction? Measured before costs, 25 coins."""
        return svc.ingredients()

    @r.get("/paper/forward")
    def paper_forward(entry: str, exit: str, htf: str = "4h", ltf: str = "15m") -> ForwardOut:
        """Forward paper trading: the playbook's trades recorded live, as they happened."""
        h, lt = _pair(htf, ltf)
        try:
            return svc.forward(h, lt, entry, exit)
        except BadRequest as err:
            raise HTTPException(422, str(err)) from err

    @r.get("/playbook/{symbol}")
    def playbook_live(
        symbol: str,
        htf: str = "4h",
        ltf: str = "15m",
        days: Annotated[int, Query(ge=1, le=14)] = 3,
    ) -> PlaybookLiveOut:
        """Recent HTF setups at a level and their stage on the LTF (no orders are placed)."""
        h, lt = _pair(htf, ltf)
        return svc.playbook_live(_symbol(symbol), h, lt, days)

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
        tf: str = "4h",
        zone_tf: Annotated[str | None, Query(alias="zoneTf")] = None,
        context: str = "*",
    ) -> StatsOut:
        t = _tf(tf)
        try:
            return svc.stats(t, _tf(zone_tf) if zone_tf else t, context)
        except BadRequest as err:
            raise HTTPException(422, str(err)) from err

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
