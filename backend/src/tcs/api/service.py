"""What the endpoints do, kept out of the HTTP layer so it is testable on its own."""

from __future__ import annotations

import math
import threading
import time
from collections import OrderedDict
from typing import Any

from tcs.analysis.catalog import CATALOG, RULESET_VERSION
from tcs.analysis.checklist import MAX_SCORE
from tcs.analysis.engine import analyze
from tcs.api import convert
from tcs.api.schemas import (
    AnalysisOut,
    CandlesOut,
    CatalogOut,
    PatternOut,
    ScannerItemOut,
    ScannerOut,
)
from tcs.common.timeframes import TF_MS, Timeframe, is_at_least, last_closed_open
from tcs.config import Settings
from tcs.marketdata.history import History
from tcs.store.sqlite import Store

#: Higher-timeframe candles loaded before the chart window, so its levels exist from the start.
LEVEL_WARMUP = 300
CACHE_SIZE = 128
#: Timeframes patterns are looked for on (the chart's Patterns menu).
PATTERN_TFS: tuple[Timeframe, ...] = ("15m", "1h", "4h", "1d")


def now_ms() -> int:
    return int(time.time() * 1000)


class BadRequest(ValueError):
    pass


class Service:
    def __init__(
        self, settings: Settings, store: Store | None = None, history: History | None = None
    ):
        self.settings = settings
        self.store = store or Store(settings.db_path)
        self.history = history or History(self.store)
        self._cache: OrderedDict[tuple[Any, ...], AnalysisOut] = OrderedDict()
        self._lock = threading.Lock()
        self._symbol_locks: dict[str, threading.Lock] = {}

    def _symbol_lock(self, key: str) -> threading.Lock:
        with self._lock:
            return self._symbol_locks.setdefault(key, threading.Lock())

    # Catalogue ---------------------------------------------------------------

    def catalog(self) -> CatalogOut:
        return CatalogOut(
            ruleset=RULESET_VERSION,
            patterns=[
                PatternOut(
                    id=p.id,
                    label=p.label,
                    kind=p.kind,
                    bias=p.bias,
                    source=p.source,
                    summary=p.summary,
                )
                for p in CATALOG
            ],
            max_score=MAX_SCORE,
            timeframes=list(PATTERN_TFS),
            universe=list(self.settings.universe),
        )

    # Candles and analysis ----------------------------------------------------

    def candles(self, symbol: str, tf: Timeframe, limit: int, now: int | None = None) -> CandlesOut:
        now = now or now_ms()
        since = last_closed_open(now, tf) - (limit - 1) * TF_MS[tf]
        with self._symbol_lock(f"{symbol}|{tf}"):
            cov = self.history.ensure(symbol, tf, since, now)
        s = self.history.load(symbol, tf, since, now)
        rows = [
            (
                int(s.open_time[i]),
                float(s.open[i]),
                float(s.high[i]),
                float(s.low[i]),
                float(s.close[i]),
                float(s.volume[i]),
                None
                if s.taker_buy is None or math.isnan(s.taker_buy[i])
                else float(s.taker_buy[i]),
            )
            for i in range(len(s))
        ]
        return CandlesOut(symbol=symbol, tf=tf, candles=rows, coverage=convert.coverage(cov))

    def analysis(
        self, symbol: str, tf: Timeframe, zone_tf: Timeframe, limit: int, now: int | None = None
    ) -> AnalysisOut:
        """Patterns, zones and order blocks on the last ``limit`` closed candles: the chart's view."""
        if not is_at_least(zone_tf, tf):
            raise BadRequest(
                "zone timeframe must be the same as or higher than the pattern timeframe"
            )
        now = now or now_ms()
        since = last_closed_open(now, tf) - (limit - 1) * TF_MS[tf]
        with self._symbol_lock(f"{symbol}|{tf}"):
            cov = self.history.ensure(symbol, tf, since, now)
        zone_since = since - LEVEL_WARMUP * TF_MS[zone_tf]
        if zone_tf == tf:
            zcov = cov
        else:
            with self._symbol_lock(f"{symbol}|{zone_tf}"):
                zcov = self.history.ensure(symbol, zone_tf, zone_since, now)
        key = (symbol, tf, zone_tf, limit, cov.last, zcov.last)
        with self._lock:
            hit = self._cache.get(key)
            if hit is not None:
                self._cache.move_to_end(key)
        if hit is not None:
            return hit
        s = self.history.load(symbol, tf, since, now)
        zs = s if zone_tf == tf else self.history.load(symbol, zone_tf, zone_since, now)
        a = analyze(s, zs)
        out = AnalysisOut(
            symbol=symbol,
            tf=tf,
            zone_tf=zone_tf,
            ruleset=RULESET_VERSION,
            coverage=convert.coverage(cov),
            zone_coverage=convert.coverage(zcov),
            occurrences=[convert.occurrence(s, o) for o in a.occurrences],
            **convert.levels(a),
        )
        with self._lock:
            self._cache[key] = out
            while len(self._cache) > CACHE_SIZE:
                self._cache.popitem(last=False)
        return out

    # Scanner -----------------------------------------------------------------

    def scanner(
        self, tf: Timeframe, zone_tf: Timeframe, symbols: list[str], bars: int, limit: int = 1500
    ) -> ScannerOut:
        """Setups confirmed on the last ``bars`` closed candles of each coin, with their checks."""
        items: list[ScannerItemOut] = []
        failed: list[str] = []
        for symbol in symbols:
            try:
                a = self.analysis(symbol, tf, zone_tf, limit)
            except Exception:
                failed.append(symbol)
                continue
            if a.coverage.last is None:
                failed.append(symbol)
                continue
            cutoff = a.coverage.last - (bars - 1) * TF_MS[tf]
            items.extend(
                ScannerItemOut(symbol=symbol, occurrence=o)
                for o in a.occurrences
                if o.time >= cutoff
            )
        items.sort(key=lambda i: (-i.occurrence.score, -i.occurrence.time, i.symbol))
        return ScannerOut(
            ruleset=RULESET_VERSION, tf=tf, zone_tf=zone_tf, bars=bars, items=items, failed=failed
        )
