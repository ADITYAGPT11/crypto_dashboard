"""FastAPI app: ``/api/v1/...``. Read-only market analysis; no orders, no keys."""

from __future__ import annotations

import contextlib
import logging
from collections.abc import AsyncGenerator
from typing import Annotated

from fastapi import APIRouter, FastAPI, HTTPException, Query

from tcs.analysis.catalog import RULESET_VERSION
from tcs.api.schemas import (
    AnalysisOut,
    CandlesOut,
    CatalogOut,
    DepthColumnOut,
    DepthFeedOut,
    DepthOut,
    HealthOut,
    ScannerOut,
)
from tcs.api.service import BadRequest, Service, now_ms
from tcs.common.timeframes import Timeframe, parse_timeframe
from tcs.common.universe import is_canonical
from tcs.config import Settings
from tcs.depth.recorder import DepthRecorder

log = logging.getLogger(__name__)


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
        if depth:
            await depth.start()
        try:
            yield
        finally:
            if depth:
                await depth.stop()

    app = FastAPI(
        title="GreenMTM analysis API",
        version="0.1.0",
        description="Pattern detection, demand/supply zones, order blocks and a setup checklist. "
        "Read-only: no orders, no predictions; a human decides.",
        lifespan=lifespan,
    )
    r = APIRouter(prefix="/api/v1")

    @r.get("/health")
    def health() -> HealthOut:
        return HealthOut(ok=True, ruleset=RULESET_VERSION)

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
