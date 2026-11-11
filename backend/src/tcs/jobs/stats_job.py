"""Background batch: measure every setup over one to two years of the universe.

Runs per PATTERN timeframe. For each coin it loads the history once, detects the
patterns once, then places them against levels from each allowed zone timeframe
(same or higher) and resolves outcomes, all with ``tcs.analysis.engine``, the same
code the chart uses. Results are grouped by

    (zone timeframe, coin or '*' pooled, pattern, direction, location or '*' any)

and swapped into the store atomically when the run finishes.

This is independent of what any chart is showing; it only answers "how has this
setup done in the past?".
"""

from __future__ import annotations

import logging
import time
from collections import defaultdict
from dataclasses import asdict
from typing import Any

from tcs.analysis.catalog import RULESET_VERSION
from tcs.analysis.engine import Occurrence, analyze, detect_levels, detect_patterns
from tcs.analysis.stats import Resolved, summarize
from tcs.common.series import Series
from tcs.common.timeframes import TIMEFRAMES, Timeframe, is_at_least
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


def _now() -> int:
    return int(time.time() * 1000)


def run_stats(settings: Settings, tf: Timeframe, now: int | None = None) -> dict[str, Any]:
    """One full run for pattern timeframe ``tf``. Safe to call from a worker process."""
    now = now or _now()
    store = Store(settings.db_path)
    history = History(store)
    since = now - settings.stats_days * DAY_MS
    meta: dict[str, Any] = {
        "coins": list(settings.universe),
        "done": 0,
        "failed": [],
        "since": since,
        "until": None,
        "candles": 0,
        "days": settings.stats_days,
    }
    store.start_run(RULESET_VERSION, tf, now, meta)
    groups: dict[Key, list[Occurrence]] = defaultdict(list)
    cases: list[tuple[str, str, str, str, str, int, str, dict[str, Any]]] = []
    try:
        for symbol in settings.universe:
            try:
                series = _load(history, symbol, tf, since, now)
                if len(series) < 100:
                    raise ValueError(f"only {len(series)} candles")
                hits = detect_patterns(series)
                for zone_tf in zone_tfs_for(tf):
                    level_series = (
                        series if zone_tf == tf else _load(history, symbol, zone_tf, since, now)
                    )
                    a = analyze(series, level_series, detect_levels(level_series), hits=hits)
                    for o in a.occurrences:
                        h = o.hit
                        groups[(zone_tf, symbol, h.pattern, h.direction, o.location)].append(o)
                        cases.append(
                            (
                                zone_tf,
                                symbol,
                                h.pattern,
                                h.direction,
                                o.location,
                                int(series.open_time[h.index]),
                                o.outcome.result,
                                _case(series, o),
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
        store.replace_stats(RULESET_VERSION, tf, _aggregate(groups), cases)
        store.finish_run(RULESET_VERSION, tf, _now(), "done", meta)
    except Exception as err:
        meta["error"] = str(err)
        store.finish_run(RULESET_VERSION, tf, _now(), "failed", meta)
        raise
    return meta


def _load(history: History, symbol: str, tf: Timeframe, since: int, now: int) -> Series:
    history.ensure(symbol, tf, since, now)
    return history.load(symbol, tf, since, now)


def _case(s: Series, o: Occurrence) -> dict[str, Any]:
    h, out = o.hit, o.outcome
    return {
        "entry": h.entry,
        "stop": h.stop,
        "target": h.target,
        "movePct": round(out.move_pct, 4),
        "r": round(out.r, 4),
        "bars": out.bars,
        "exitTime": None if out.exit_index is None else int(s.open_time[out.exit_index]),
    }


def _resolved(occ: list[Occurrence]) -> tuple[list[Resolved], int]:
    done = [
        Resolved(o.outcome.result == "win", o.outcome.move_pct, o.outcome.r, o.outcome.bars)
        for o in occ
        if o.outcome.result in ("win", "loss")
    ]
    return done, sum(1 for o in occ if o.outcome.result == "expired")


def _aggregate(
    groups: dict[Key, list[Occurrence]],
) -> list[tuple[str, str, str, str, str, dict[str, Any]]]:
    """Per coin and pooled ('*'), per location and any location ('*')."""
    rolled: dict[Key, list[Occurrence]] = defaultdict(list)
    for (zone_tf, symbol, pattern, direction, location), occ in groups.items():
        for sym in (symbol, "*"):
            for loc in (location, "*"):
                rolled[(zone_tf, sym, pattern, direction, loc)].extend(occ)
    out: list[tuple[str, str, str, str, str, dict[str, Any]]] = []
    for key, occ in rolled.items():
        done, expired = _resolved(occ)
        summary = asdict(summarize(done, expired))
        summary["open"] = sum(1 for o in occ if o.outcome.result == "open")
        out.append((*key, summary))
    return out


def all_timeframes() -> tuple[Timeframe, ...]:
    return tuple(tf for tf in TIMEFRAMES if tf in STATS_TFS)
