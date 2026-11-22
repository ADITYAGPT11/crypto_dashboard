"""What the endpoints do, kept out of the HTTP layer so it is testable on its own."""

from __future__ import annotations

import math
import threading
import time
from collections import OrderedDict
from typing import Any, Literal

from tcs.analysis.catalog import CATALOG, RULESET_VERSION
from tcs.analysis.confidence import SCORE_CONTEXTS
from tcs.analysis.engine import analyze
from tcs.analysis.flow import CONTEXTS
from tcs.analysis.outcomes import MAX_HOLD_BARS, TRAIL_ATR
from tcs.analysis.stats import MIN_SAMPLE
from tcs.analysis.types import Direction
from tcs.api import convert
from tcs.api.schemas import (
    AnalysisOut,
    CandlesOut,
    CaseOut,
    CatalogOut,
    CoinSummaryOut,
    ConfidenceOut,
    ContextSummaryOut,
    OccurrenceOut,
    PatternOut,
    ScannerItemOut,
    ScannerOut,
    SetupDetailOut,
    SetupStatOut,
    StatsOut,
    SummaryOut,
)
from tcs.common.series import Series
from tcs.common.timeframes import TF_MS, Timeframe, is_at_least, last_closed_open
from tcs.config import Settings
from tcs.jobs.stats_job import DAY_MS, FINE_TF, STATS_TFS
from tcs.marketdata.history import History
from tcs.store.sqlite import Store

#: Higher-timeframe candles loaded before the chart window, so its levels exist from the start.
LEVEL_WARMUP = 300
CACHE_SIZE = 128
#: 5-minute candles kept for walking trades on the chart (the statistics period).
FINE_DAYS = 730


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
            max_hold_bars=MAX_HOLD_BARS,
            trail_atr=TRAIL_ATR,
            min_sample=MIN_SAMPLE,
            timeframes=list(STATS_TFS),
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
            return self._with_confidence(hit, tf)
        s = self.history.load(symbol, tf, since, now)
        zs = s if zone_tf == tf else self.history.load(symbol, zone_tf, zone_since, now)
        a = analyze(s, zs, fine=self._fine(symbol, since, now))
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
        return self._with_confidence(out, tf)

    def _with_confidence(self, out: AnalysisOut, tf: Timeframe) -> AnalysisOut:
        """Each occurrence with the latest run's record of its pattern at its score (read on
        every call: a statistics run can finish while the analysis is cached)."""
        if tf not in STATS_TFS or not out.occurrences:
            return out
        rows = {
            ctx: {
                (p, d): s
                for p, d, loc, s in self.store.stats(RULESET_VERSION, tf, tf, context=ctx)
                if loc == "*"
            }
            for ctx in ("*", *SCORE_CONTEXTS)
        }

        def confidence(o: OccurrenceOut) -> ConfidenceOut | None:
            tries: tuple[tuple[str, Literal["score", "pattern"]], ...] = (
                (f"score:{o.score}", "score"),
                ("*", "pattern"),
            )
            for ctx, basis in tries:
                s = rows[ctx].get((o.pattern, o.direction))
                if s is not None and s["n"] >= MIN_SAMPLE:
                    return ConfidenceOut(
                        win_rate=s["win_rate"],
                        ci_low=s["ci_low"],
                        ci_high=s["ci_high"],
                        n=s["n"],
                        basis=basis,
                        break_even=s["break_even_net"],
                        expectancy_net_r=s["expectancy_net_r"],
                        verdict=s["verdict"],
                    )
            return None

        def update(o: OccurrenceOut) -> OccurrenceOut:
            c = confidence(o)
            return o.model_copy(
                update={"confidence": c, "passes": c is not None and c.verdict == "edge"}
            )

        return out.model_copy(update={"occurrences": [update(o) for o in out.occurrences]})

    def _fine(self, symbol: str, since: int, now: int) -> Series | None:
        """5-minute candles for walking trades (``outcomes.py``), at most ``FINE_DAYS`` back.

        Fails soft: without them trades are walked on the pattern's own candles.
        """
        start = max(since, now - FINE_DAYS * DAY_MS)
        try:
            with self._symbol_lock(f"{symbol}|{FINE_TF}"):
                self.history.ensure(symbol, FINE_TF, start, now)
            fine = self.history.load(symbol, FINE_TF, start, now)
        except Exception:
            return None
        return fine if len(fine) else None

    # Statistics --------------------------------------------------------------

    def stats(
        self, tf: Timeframe, zone_tf: Timeframe, context: str = "*", symbol: str = "*"
    ) -> StatsOut:
        """Every setup's record; ``symbol`` restricts it to one coin (no order-flow split then)."""
        if context != "*" and context not in (*CONTEXTS, *SCORE_CONTEXTS):
            raise BadRequest(f"unknown context {context!r}")
        if symbol != "*" and context != "*":
            raise BadRequest("per-coin records have no order-flow split")
        rows = self.store.stats(RULESET_VERSION, tf, zone_tf, symbol=symbol, context=context)
        return StatsOut(
            ruleset=RULESET_VERSION,
            tf=tf,
            zone_tf=zone_tf,
            context=context,
            symbol=symbol,
            run=convert.run(self.store.run(RULESET_VERSION, tf)),
            setups=[
                SetupStatOut.model_validate(
                    {"pattern": p, "direction": d, "location": loc, "summary": s}
                )
                for p, d, loc, s in rows
            ],
        )

    def setup(
        self, tf: Timeframe, zone_tf: Timeframe, pattern: str, direction: str, location: str
    ) -> SetupDetailOut:
        if direction != "long" and direction != "short":
            raise BadRequest("direction must be long or short")
        side: Direction = "long" if direction == "long" else "short"
        pooled = next(
            (
                s
                for p, d, loc, s in self.store.stats(RULESET_VERSION, tf, zone_tf)
                if (p, d, loc) == (pattern, direction, location)
            ),
            None,
        )
        per_coin = self.store.setup_by_symbol(
            RULESET_VERSION, tf, zone_tf, pattern, direction, location
        )
        recent = self.store.cases(RULESET_VERSION, tf, zone_tf, pattern, direction, location)
        by_context = dict(
            self.store.contexts(RULESET_VERSION, tf, zone_tf, pattern, direction, location)
        )
        return SetupDetailOut(
            ruleset=RULESET_VERSION,
            tf=tf,
            zone_tf=zone_tf,
            pattern=pattern,
            direction=side,
            location=location,
            pooled=convert.summary(pooled),
            per_coin=sorted(
                (
                    CoinSummaryOut(symbol=sym, summary=SummaryOut.model_validate(s))
                    for sym, s in per_coin
                ),
                key=lambda c: (-c.summary.n, c.symbol),
            ),
            contexts=[
                ContextSummaryOut(context=c, summary=SummaryOut.model_validate(by_context[c]))
                for c in CONTEXTS
                if c in by_context
            ],
            recent=[CaseOut.model_validate(c) for c in recent],
        )

    def scanner(
        self, tf: Timeframe, zone_tf: Timeframe, symbols: list[str], bars: int, limit: int = 1500
    ) -> ScannerOut:
        """Setups confirmed on the last ``bars`` closed candles of each coin, with their record."""
        pooled = {(p, d, loc): s for p, d, loc, s in self.store.stats(RULESET_VERSION, tf, zone_tf)}
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
            own = {
                (p, d, loc): s
                for p, d, loc, s in self.store.stats(RULESET_VERSION, tf, zone_tf, symbol)
            }
            for o in a.occurrences:
                if o.time >= cutoff:
                    k = (o.pattern, o.direction, o.location)
                    items.append(
                        ScannerItemOut(
                            symbol=symbol,
                            occurrence=o,
                            pooled=convert.summary(pooled.get(k)),
                            own=convert.summary(own.get(k)),
                        )
                    )
        items.sort(key=lambda i: (-i.occurrence.time, i.symbol))
        return ScannerOut(
            ruleset=RULESET_VERSION,
            tf=tf,
            zone_tf=zone_tf,
            bars=bars,
            items=items,
            failed=failed,
            run=convert.run(self.store.run(RULESET_VERSION, tf)),
        )
