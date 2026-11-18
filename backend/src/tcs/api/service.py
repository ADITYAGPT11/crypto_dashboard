"""What the endpoints do, kept out of the HTTP layer so it is testable on its own."""

from __future__ import annotations

import math
import threading
import time
from collections import OrderedDict
from typing import Any

from tcs.analysis import playbook as pb
from tcs.analysis.catalog import CATALOG, RULESET_VERSION
from tcs.analysis.engine import analyze
from tcs.analysis.flow import CONTEXTS
from tcs.analysis.outcomes import MAX_HOLD_BARS
from tcs.analysis.stats import MIN_SAMPLE
from tcs.analysis.types import Direction, Location, PatternHit
from tcs.api import convert
from tcs.api.schemas import (
    AnalysisOut,
    CandlesOut,
    CaseOut,
    CatalogOut,
    CoinSummaryOut,
    ContextSummaryOut,
    PaperTradeOut,
    PatternOut,
    PlaybookLiveOut,
    PlaybookParamsOut,
    PlaybookStatsOut,
    PlaybookTradeOut,
    PlaybookTradesOut,
    PlaybookTriggerOut,
    PlaybookVariantOut,
    RSummaryOut,
    ScannerItemOut,
    ScannerOut,
    SetupDetailOut,
    SetupStatOut,
    StatsOut,
    SummaryOut,
)
from tcs.common.timeframes import TF_MS, Timeframe, is_at_least, last_closed_open
from tcs.config import Settings
from tcs.jobs.playbook_job import pair_key
from tcs.jobs.stats_job import STATS_TFS
from tcs.marketdata.history import History
from tcs.store.sqlite import Store

#: Higher-timeframe candles loaded before the chart window, so its levels exist from the start.
LEVEL_WARMUP = 300
CACHE_SIZE = 128


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

    # Statistics --------------------------------------------------------------

    def stats(self, tf: Timeframe, zone_tf: Timeframe, context: str = "*") -> StatsOut:
        if context != "*" and context not in CONTEXTS:
            raise BadRequest(f"unknown context {context!r}")
        rows = self.store.stats(RULESET_VERSION, tf, zone_tf, context=context)
        return StatsOut(
            ruleset=RULESET_VERSION,
            tf=tf,
            zone_tf=zone_tf,
            context=context,
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

    # Playbook (multi-timeframe) --------------------------------------------------

    def playbook_stats(self, htf: Timeframe, ltf: Timeframe) -> PlaybookStatsOut:
        pair = pair_key(htf, ltf)
        rows = self.store.playbook_stats(RULESET_VERSION, pair)
        by = {(e, x, seg): s for e, x, seg, s in rows}

        def summ(e: str, x: str, seg: str) -> RSummaryOut | None:
            d = by.get((e, x, seg))
            return None if d is None else RSummaryOut.model_validate(d)

        r = self.store.run(RULESET_VERSION, pair)
        return PlaybookStatsOut(
            ruleset=RULESET_VERSION,
            htf=htf,
            ltf=ltf,
            run=convert.run(r),
            split=(r or {}).get("meta", {}).get("split"),
            params=PlaybookParamsOut(
                trigger_bars=pb.TRIGGER_BARS,
                entry_bars=pb.ENTRY_BARS,
                stop_atr=pb.STOP_ATR,
                max_risk_htf_atr=pb.MAX_RISK_HTF_ATR,
                min_stop_pct=pb.MIN_STOP_PCT,
                fib_level=pb.FIB_LEVEL,
                max_hold_bars=pb.MAX_HOLD_BARS,
                breakeven_r=pb.BREAKEVEN_R,
                partial_r=pb.PARTIAL_R,
                partial_share=pb.PARTIAL_SHARE,
                maker=pb.MAKER,
                taker=pb.TAKER,
                slippage=pb.SLIPPAGE,
            ),
            variants=[
                PlaybookVariantOut(
                    entry=e,
                    exit=x,
                    all=summ(e, x, "all"),
                    in_sample=summ(e, x, "in"),
                    out_of_sample=summ(e, x, "out"),
                )
                for e in pb.ENTRIES
                for x in pb.EXITS
            ],
        )

    def playbook_live(
        self, symbol: str, htf: Timeframe, ltf: Timeframe, days: int, now: int | None = None
    ) -> PlaybookLiveOut:
        """Recent HTF setups at a level and where each stands on the LTF right now."""
        now = now or now_ms()
        # HTF history long enough for its levels; LTF from the oldest trigger shown on.
        h_since = (
            last_closed_open(now, htf)
            - (LEVEL_WARMUP + days * 86_400_000 // TF_MS[htf]) * TF_MS[htf]
        )
        l_since = now - (days + 2) * 86_400_000
        with self._symbol_lock(f"{symbol}|{htf}"):
            hcov = self.history.ensure(symbol, htf, h_since, now)
        with self._symbol_lock(f"{symbol}|{ltf}"):
            lcov = self.history.ensure(symbol, ltf, l_since, now)
        h = self.history.load(symbol, htf, h_since, now)
        lt = self.history.load(symbol, ltf, l_since, now)
        a = analyze(h)
        cutoff = now - days * 86_400_000
        recent: list[tuple[PatternHit, Location]] = [
            (o.hit, o.location) for o in a.occurrences if int(h.open_time[o.hit.index]) >= cutoff
        ]
        triggers = pb.run_playbook(h, lt, recent) if len(lt) else []

        def at(i: int | None) -> int | None:
            return None if i is None or i >= len(lt) else int(lt.open_time[i])

        def num(x: float | None) -> float | None:
            return None if x is None or not math.isfinite(x) else x

        out = [
            PlaybookTriggerOut(
                pattern=t.hit.pattern,
                direction=t.hit.direction,
                location=t.location,
                time=int(h.open_time[t.hit.index]),
                known_at=h.close_time(t.hit.index),
                window_end=h.close_time(t.hit.index) + pb.TRIGGER_BARS * TF_MS[htf],
                stage=t.stage,
                htf_stop=t.hit.stop,
                htf_target=t.hit.target,
                choch_time=at(t.choch_index),
                broke=t.broke,
                impulse_low=t.impulse_low,
                impulse_high=t.impulse_high,
                trades=[
                    PlaybookTradeOut(
                        entry_kind=tr.entry_kind,
                        exit_kind=tr.exit_kind,
                        status=tr.status,
                        note=tr.note,
                        entry=num(tr.entry),
                        stop=num(tr.stop),
                        target=num(tr.target),
                        fill_time=at(tr.fill_index),
                        exit_time=at(tr.exit_index),
                        exit_price=num(tr.exit_price),
                        reason=tr.reason,
                        stop_now=num(tr.stop_now),
                        r_net=tr.r_net,
                    )
                    for tr in t.trades
                ],
            )
            for t in triggers
        ]
        out.sort(key=lambda t: -t.time)
        return PlaybookLiveOut(
            symbol=symbol,
            htf=htf,
            ltf=ltf,
            ruleset=RULESET_VERSION,
            coverage=convert.coverage(hcov),
            ltf_coverage=convert.coverage(lcov),
            triggers=out,
        )

    def playbook_trades(
        self, htf: Timeframe, ltf: Timeframe, entry: str, exit: str
    ) -> PlaybookTradesOut:
        if entry not in pb.ENTRIES or exit not in pb.EXITS:
            raise BadRequest(
                f"entry must be one of {', '.join(pb.ENTRIES)}; exit one of {', '.join(pb.EXITS)}"
            )
        pair = pair_key(htf, ltf)
        rows = self.store.playbook_all_trades(RULESET_VERSION, pair, entry, exit)
        return PlaybookTradesOut.model_validate(
            {
                "ruleset": RULESET_VERSION,
                "htf": htf,
                "ltf": ltf,
                "entry": entry,
                "exit": exit,
                "run": convert.run(self.store.run(RULESET_VERSION, pair)),
                "trades": [
                    PaperTradeOut.model_validate({"rGross": t.get("rNet", 0.0), **t}) for t in rows
                ],
            }
        )
