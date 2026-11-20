"""Background batch: measure every setup over one to two years of the universe.

Runs per PATTERN timeframe. For each coin it loads the history once, detects the
patterns once, then places them against levels from each allowed zone timeframe
(same or higher) and resolves outcomes, all with ``tcs.analysis.engine``, the same
code the chart uses. Results are grouped by

    (zone timeframe, coin or '*' pooled, pattern, direction, location or '*' any)

and, pooled across coins only, also per order-flow context (``analysis/flow.py``: delta
confirms / against / neutral, CVD divergence yes / no), so every setup can be compared with
and without flow agreeing. Swapped into the store atomically when the run finishes.

This is independent of what any chart is showing; it only answers "how has this
setup done in the past?".
"""

from __future__ import annotations

import logging
import time
from collections import defaultdict
from dataclasses import asdict, dataclass
from typing import Any

from tcs.analysis.catalog import RULESET_VERSION
from tcs.analysis.costs import Cost, CostModel, Funding, cost_pct, trade_cost
from tcs.analysis.engine import Occurrence, analyze, detect_levels, detect_patterns
from tcs.analysis.flow import contexts
from tcs.analysis.indicators import atr
from tcs.analysis.outcomes import RIDE_ATR, ride_baseline
from tcs.analysis.stats import (
    Resolved,
    RideBase,
    ride_base,
    summarize,
    summarize_ride,
    summarize_trailing,
)
from tcs.common.series import Series
from tcs.common.timeframes import TF_MS, TIMEFRAMES, Timeframe, is_at_least
from tcs.config import Settings
from tcs.marketdata.history import History
from tcs.store.sqlite import Store

log = logging.getLogger(__name__)
DAY_MS = 86_400_000
#: Detection timeframes the job measures, and the zone timeframes allowed for each.
STATS_TFS: tuple[Timeframe, ...] = ("1h", "4h", "1d")
ZONE_TFS: tuple[Timeframe, ...] = ("1h", "4h", "1d")


def zone_tfs_for(tf: Timeframe) -> list[Timeframe]:
    return [z for z in ZONE_TFS if is_at_least(z, tf)]


Key = tuple[str, str, str, str, str]  # zone_tf, symbol, pattern, direction, location


@dataclass(frozen=True, slots=True)
class Costed:
    """An occurrence with the cost of each exit (None where the trade did not close)."""

    symbol: str
    o: Occurrence
    fixed: Cost | None
    trail: Cost | None
    #: Costs of the after-pattern ride in percent (None while it is open).
    ride_pct: float | None


def _costed(
    symbol: str, s: Series, o: Occurrence, model: CostModel, funding: Funding, tf: Timeframe
) -> Costed:
    ms = TF_MS[tf]
    entry = int(s.open_time[o.hit.index]) + ms  # the confirmation candle's close

    def cost(exit_index: int | None) -> Cost | None:
        if exit_index is None:
            return None
        return trade_cost(model, funding, o.hit, entry, int(s.open_time[exit_index]) + ms)

    ride = o.ride.exit_index
    ride_pct = (
        None
        if ride is None
        else cost_pct(model, funding, o.hit.direction, entry, int(s.open_time[ride]) + ms)
    )
    return Costed(symbol, o, cost(o.outcome.exit_index), cost(o.trail.exit_index), ride_pct)


BaseKey = tuple[str, str]  # symbol, direction


def _ride_base(s: Series) -> dict[str, RideBase]:
    """The after-pattern ride from evenly spaced candles, per direction (the random control)."""
    a = atr(s, RIDE_ATR)
    return {
        d: ride_base([(r.move_pct, r.best_pct) for r in ride_baseline(s, d, a)])
        for d in ("long", "short")
    }


def _weighted_base(occ: list[Costed], bases: dict[BaseKey, RideBase]) -> RideBase:
    """Random-candle control with the same mix of coins and directions as ``occ``."""
    weights: dict[BaseKey, int] = defaultdict(int)
    for c in occ:
        if c.o.ride.result == "closed":
            weights[(c.symbol, c.o.hit.direction)] += 1
    parts = [(bases[k], w) for k, w in weights.items() if k in bases and bases[k].n > 0]
    total = sum(w for _, w in parts)
    if total == 0:
        return RideBase(0, 0.0, 0.0, 0.0)
    return RideBase(
        n=sum(b.n for b, _ in parts),
        favourable_rate=sum(b.favourable_rate * w for b, w in parts) / total,
        avg_move_pct=sum(b.avg_move_pct * w for b, w in parts) / total,
        avg_best_pct=sum(b.avg_best_pct * w for b, w in parts) / total,
    )


def _now() -> int:
    return int(time.time() * 1000)


def run_stats(settings: Settings, tf: Timeframe, now: int | None = None) -> dict[str, Any]:
    """One full run for pattern timeframe ``tf``. Safe to call from a worker process."""
    now = now or _now()
    store = Store(settings.db_path)
    history = History(store)
    since = now - settings.stats_days * DAY_MS
    model = CostModel(settings.fee_pct, settings.slippage_pct)
    meta: dict[str, Any] = {
        "costs": {
            "feePct": model.fee_pct,
            "slippagePct": model.slippage_pct,
            "roundTripPct": model.round_trip_pct,
            "fundingUntil": {},
        },
        "coins": list(settings.universe),
        "done": 0,
        "failed": [],
        "since": since,
        "until": None,
        "candles": 0,
        "days": settings.stats_days,
    }
    store.start_run(RULESET_VERSION, tf, now, meta)
    groups: dict[Key, list[Costed]] = defaultdict(list)
    bases: dict[BaseKey, RideBase] = {}
    cases: list[tuple[str, str, str, str, str, int, str, dict[str, Any]]] = []
    try:
        for symbol in settings.universe:
            try:
                series = _load(history, symbol, tf, since, now)
                if len(series) < 100:
                    raise ValueError(f"only {len(series)} candles")
                hits = detect_patterns(series)
                rows = history.ensure_funding(symbol, since, now)
                funding = Funding(rows)
                meta["costs"]["fundingUntil"][symbol] = rows[-1][0] if rows else None
                for d, b in _ride_base(series).items():
                    bases[(symbol, d)] = b
                for zone_tf in zone_tfs_for(tf):
                    level_series = (
                        series if zone_tf == tf else _load(history, symbol, zone_tf, since, now)
                    )
                    a = analyze(series, level_series, detect_levels(level_series), hits=hits)
                    for o in a.occurrences:
                        h = o.hit
                        c = _costed(symbol, series, o, model, funding, tf)
                        groups[(zone_tf, symbol, h.pattern, h.direction, o.location)].append(c)
                        cases.append(
                            (
                                zone_tf,
                                symbol,
                                h.pattern,
                                h.direction,
                                o.location,
                                int(series.open_time[h.index]),
                                o.outcome.result,
                                _case(series, c),
                            )
                        )
                meta["candles"] += len(series)
                last = int(series.open_time[-1])
                meta["until"] = last if meta["until"] is None else min(meta["until"], last)
            except Exception as err:  # one coin failing must never stop the others
                log.warning("stats %s %s failed: %s", symbol, tf, err)
                meta["failed"].append(symbol)
            meta["done"] += 1
            store.update_run(RULESET_VERSION, tf, meta)
        store.replace_stats(RULESET_VERSION, tf, _aggregate(groups, bases), cases)
        store.finish_run(RULESET_VERSION, tf, _now(), "done", meta)
    except Exception as err:
        meta["error"] = str(err)
        store.finish_run(RULESET_VERSION, tf, _now(), "failed", meta)
        raise
    return meta


def _load(history: History, symbol: str, tf: Timeframe, since: int, now: int) -> Series:
    history.ensure(symbol, tf, since, now)
    return history.load(symbol, tf, since, now)


def _case(s: Series, c: Costed) -> dict[str, Any]:
    o = c.o
    h, out = o.hit, o.outcome
    return {
        "entry": h.entry,
        "stop": h.stop,
        "target": h.target,
        "movePct": round(out.move_pct, 4),
        "r": round(out.r, 4),
        "bars": out.bars,
        "exitTime": None if out.exit_index is None else int(s.open_time[out.exit_index]),
        "deltaRatio": None if o.flow.delta_ratio is None else round(o.flow.delta_ratio, 4),
        "flow": o.flow.flow,
        "cvdDivergence": o.flow.divergence,
        "trailResult": o.trail.result,
        "trailR": round(o.trail.r, 4),
        "trailBars": o.trail.bars,
        "trailExitTime": None
        if o.trail.exit_index is None
        else int(s.open_time[o.trail.exit_index]),
        "costR": None if c.fixed is None else round(c.fixed.total_r, 4),
        "netR": None if c.fixed is None else round(out.r - c.fixed.total_r, 4),
        "trailNetR": None if c.trail is None else round(o.trail.r - c.trail.total_r, 4),
        "rideMovePct": None if o.ride.result == "open" else round(o.ride.move_pct, 4),
        "rideBestPct": None if o.ride.result == "open" else round(o.ride.best_pct, 4),
        "rideBars": None if o.ride.result == "open" else o.ride.bars,
    }


def _resolved(occ: list[Costed]) -> tuple[list[Resolved], int]:
    done = [
        Resolved(
            c.o.outcome.result == "win",
            c.o.outcome.move_pct,
            c.o.outcome.r,
            c.o.outcome.bars,
            c.fixed.total_r if c.fixed else 0.0,
        )
        for c in occ
        if c.o.outcome.result in ("win", "loss")
    ]
    return done, sum(1 for c in occ if c.o.outcome.result == "expired")


StatKey = tuple[str, str, str, str, str, str]  # Key + order-flow context


def _aggregate(
    groups: dict[Key, list[Costed]],
    bases: dict[BaseKey, RideBase] | None = None,
) -> list[tuple[str, str, str, str, str, str, dict[str, Any]]]:
    """Per coin and pooled ('*'), per location and any location ('*'); pooled rows also per
    order-flow context (context '*' = every case)."""
    rolled: dict[StatKey, list[Costed]] = defaultdict(list)
    for (zone_tf, symbol, pattern, direction, location), occ in groups.items():
        for loc in (location, "*"):
            rolled[(zone_tf, symbol, pattern, direction, loc, "*")].extend(occ)
            rolled[(zone_tf, "*", pattern, direction, loc, "*")].extend(occ)
            for c in occ:
                for ctx in contexts(c.o.flow):
                    rolled[(zone_tf, "*", pattern, direction, loc, ctx)].append(c)
    out: list[tuple[str, str, str, str, str, str, dict[str, Any]]] = []
    for key, occ in rolled.items():
        done, expired = _resolved(occ)
        summary = asdict(summarize(done, expired))
        summary["open"] = sum(1 for c in occ if c.o.outcome.result == "open")
        summary["trail"] = asdict(
            summarize_trailing(
                [
                    (c.o.trail.r, c.o.trail.bars, c.trail.total_r if c.trail else 0.0)
                    for c in occ
                    if c.o.trail.result != "open"
                ]
            )
        )
        summary["ride"] = asdict(
            summarize_ride(
                [
                    (r.move_pct, r.best_pct, r.worst_pct, r.bars, c.ride_pct or 0.0)
                    for c in occ
                    if (r := c.o.ride).result == "closed"
                ],
                _weighted_base(occ, bases or {}),
            )
        )
        out.append((*key, summary))
    return out


def all_timeframes() -> tuple[Timeframe, ...]:
    return tuple(tf for tf in TIMEFRAMES if tf in STATS_TFS)
