"""Background batch: measure every playbook variant over one to two years of the universe.

For each coin: the HTF candles are analysed once (patterns located against HTF levels, the same
``engine.analyze`` the chart uses), then ``analysis.playbook.run_playbook`` follows every setup
at a level through the LTF candles. Closed trades are pooled across coins and summarised per
(entry, exit) variant, for the whole period and split in time: the first ``IN_SAMPLE`` share
("in") and the rest ("out"). The rules were fixed before this data was looked at, so "out"
mostly shows whether the record holds up on the latest months.
"""

from __future__ import annotations

import logging
import time
from collections import defaultdict
from dataclasses import asdict
from typing import Any

from tcs.analysis.catalog import RULESET_VERSION
from tcs.analysis.engine import analyze
from tcs.analysis.playbook import Trade, Trigger, run_playbook
from tcs.analysis.playbook_stats import ClosedTrade, summarize_r
from tcs.common.series import Series
from tcs.common.timeframes import Timeframe
from tcs.config import Settings
from tcs.marketdata.history import History
from tcs.store.sqlite import Store

log = logging.getLogger(__name__)
DAY_MS = 86_400_000
IN_SAMPLE = 0.7
#: The pairs measured: (higher timeframe, lower timeframe).
PAIRS: tuple[tuple[Timeframe, Timeframe], ...] = (("4h", "15m"),)


def pair_key(htf: Timeframe, ltf: Timeframe) -> str:
    return f"{htf}>{ltf}"


def run_playbook_stats(
    settings: Settings, htf: Timeframe = "4h", ltf: Timeframe = "15m", now: int | None = None
) -> dict[str, Any]:
    now = now or int(time.time() * 1000)
    store = Store(settings.db_path)
    history = History(store)
    since = now - settings.stats_days * DAY_MS
    cut = since + int(IN_SAMPLE * (now - since))
    pair = pair_key(htf, ltf)
    meta: dict[str, Any] = {
        "coins": list(settings.universe),
        "done": 0,
        "failed": [],
        "since": since,
        "until": None,
        "candles": 0,
        "days": settings.stats_days,
        "split": cut,
    }
    store.start_run(RULESET_VERSION, pair, now, meta)
    rows: dict[tuple[str, str, str, str], list[ClosedTrade]] = defaultdict(list)
    trades_out: list[tuple[str, str, str, int, dict[str, Any]]] = []
    try:
        for symbol in settings.universe:
            try:
                h = _load(history, symbol, htf, since, now)
                lt = _load(history, symbol, ltf, since, now)
                if len(h) < 100 or len(lt) < 1000:
                    raise ValueError(f"only {len(h)} {htf} / {len(lt)} {ltf} candles")
                a = analyze(h)
                triggers = run_playbook(h, lt, [(o.hit, o.location) for o in a.occurrences])
                for t in triggers:
                    when = int(h.open_time[t.hit.index])
                    segment = "in" if when < cut else "out"
                    for tr in t.trades:
                        if tr.status != "closed":
                            continue
                        c = _closed(tr)
                        for sym in (symbol, "*"):
                            rows[(sym, tr.entry_kind, tr.exit_kind, "all")].append(c)
                        rows[("*", tr.entry_kind, tr.exit_kind, segment)].append(c)
                        trades_out.append(
                            (symbol, tr.entry_kind, tr.exit_kind, when, _detail(t, tr, lt))
                        )
                meta["candles"] += len(h) + len(lt)
                last = int(lt.open_time[-1])
                meta["until"] = last if meta["until"] is None else min(meta["until"], last)
            except Exception as err:  # one coin failing must never stop the others
                log.warning("playbook %s %s failed: %s", symbol, pair, err)
                meta["failed"].append(symbol)
            meta["done"] += 1
            store.update_run(RULESET_VERSION, pair, meta)
        stats = [(*k, asdict(summarize_r(v))) for k, v in rows.items()]
        store.replace_playbook(RULESET_VERSION, pair, stats, trades_out)
        store.finish_run(RULESET_VERSION, pair, int(time.time() * 1000), "done", meta)
    except Exception as err:
        meta["error"] = str(err)
        store.finish_run(RULESET_VERSION, pair, int(time.time() * 1000), "failed", meta)
        raise
    return meta


def _load(history: History, symbol: str, tf: Timeframe, since: int, now: int) -> Series:
    history.ensure(symbol, tf, since, now)
    return history.load(symbol, tf, since, now)


def _closed(tr: Trade) -> ClosedTrade:
    bars = (tr.exit_index or 0) - (tr.fill_index or 0)
    return ClosedTrade(tr.r_net, tr.r_gross, tr.baseline_r, bars)


def _detail(t: Trigger, tr: Trade, lt: Series) -> dict[str, Any]:
    def at(i: int | None) -> int | None:
        return None if i is None else int(lt.open_time[i])

    return {
        "pattern": t.hit.pattern,
        "direction": t.hit.direction,
        "location": t.location,
        "entryPrice": round(tr.entry, 8),
        "stop": round(tr.stop, 8),
        "exitPrice": None if tr.exit_price is None else round(tr.exit_price, 8),
        "reason": tr.reason,
        "rNet": round(tr.r_net, 4),
        "baselineR": None if tr.baseline_r is None else round(tr.baseline_r, 4),
        "fillTime": at(tr.fill_index),
        "exitTime": at(tr.exit_index),
    }
