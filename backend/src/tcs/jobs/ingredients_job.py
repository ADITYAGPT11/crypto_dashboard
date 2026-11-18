"""Background batch: does any single ingredient predict direction? (Phase 2 research)

Over the playbook universe (research 10 + 15 more coins) and one to two years of 4h candles, each
ingredient's non-overlapping signals are followed for 1, 6 and 24 candles and pooled. Segments:
``all``, ``orig10`` / ``new15`` (coins), ``older`` / ``newer`` (first 70% / latest 30% of time).
The verdict needs the Bonferroni-adjusted range to exclude zero on all coins and the same sign on
the new coins and the newer months.
"""

from __future__ import annotations

import logging
import time
from collections import defaultdict
from dataclasses import asdict
from typing import Any

from tcs.analysis.indicators import atr
from tcs.analysis.ingredient_stats import (
    HORIZONS,
    Move,
    forward_moves,
    summarize_moves,
    verdict,
)
from tcs.analysis.ingredients import INGREDIENTS, INGREDIENTS_VERSION, signals
from tcs.common.timeframes import TF_MS
from tcs.common.universe import RESEARCH_UNIVERSE
from tcs.config import Settings
from tcs.marketdata.history import History
from tcs.store.sqlite import Store

log = logging.getLogger(__name__)
DAY_MS = 86_400_000
IN_SAMPLE = 0.7
RUN_KEY = "research:ingredients"
SEGMENTS = ("all", "orig10", "new15", "older", "newer")


def run_ingredients(settings: Settings, now: int | None = None) -> dict[str, Any]:
    now = now or int(time.time() * 1000)
    store = Store(settings.db_path)
    history = History(store)
    since = now - settings.stats_days * DAY_MS
    cut = since + int(IN_SAMPLE * (now - since))
    coins = list(settings.playbook_universe)
    meta: dict[str, Any] = {
        "coins": coins,
        "done": 0,
        "failed": [],
        "since": since,
        "until": None,
        "candles": 0,
        "days": settings.stats_days,
        "split": cut,
        "version": INGREDIENTS_VERSION,
    }
    store.start_run(INGREDIENTS_VERSION, RUN_KEY, now, meta)
    pooled: dict[tuple[str, int, str], list[Move]] = defaultdict(list)
    try:
        for symbol in coins:
            try:
                history.ensure(symbol, "4h", since, now)
                s = history.load(symbol, "4h", since, now)
                lv_since = since - 300 * TF_MS["1d"]
                history.ensure(symbol, "1d", lv_since, now)
                lv = history.load(symbol, "1d", lv_since, now)
                funding = history.ensure_funding(symbol, since - 100 * DAY_MS, now)
                if len(s) < 300:
                    raise ValueError(f"only {len(s)} 4h candles")
                sigs = signals(s, lv, funding)
                a = atr(s)
                group = "orig10" if symbol in RESEARCH_UNIVERSE else "new15"
                for ing in INGREDIENTS:
                    for h in HORIZONS:
                        for m in forward_moves(s, sigs[ing.id], h, a):
                            pooled[(ing.id, h, "all")].append(m)
                            pooled[(ing.id, h, group)].append(m)
                            pooled[(ing.id, h, "older" if m.time < cut else "newer")].append(m)
                meta["candles"] += len(s)
                last = int(s.open_time[-1])
                meta["until"] = last if meta["until"] is None else min(meta["until"], last)
            except Exception as err:  # one coin failing must never stop the others
                log.warning("ingredients %s failed: %s", symbol, err)
                meta["failed"].append(symbol)
            meta["done"] += 1
            store.update_run(INGREDIENTS_VERSION, RUN_KEY, meta)
        tests = len(INGREDIENTS) * len(HORIZONS)
        rows: list[tuple[str, int, str, dict[str, Any]]] = []
        for ing in INGREDIENTS:
            for h in HORIZONS:
                summ = {seg: summarize_moves(pooled[(ing.id, h, seg)], tests) for seg in SEGMENTS}
                v = verdict(summ["all"], summ["new15"], summ["newer"])
                for seg in SEGMENTS:
                    d = asdict(summ[seg])
                    if seg == "all":
                        d["verdict"] = v
                    rows.append((ing.id, h, seg, d))
        store.replace_research(INGREDIENTS_VERSION, rows)
        meta["tests"] = tests
        store.finish_run(INGREDIENTS_VERSION, RUN_KEY, int(time.time() * 1000), "done", meta)
    except Exception as err:
        meta["error"] = str(err)
        store.finish_run(INGREDIENTS_VERSION, RUN_KEY, int(time.time() * 1000), "failed", meta)
        raise
    return meta
