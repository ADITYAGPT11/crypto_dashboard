"""Domain results (indices into a series) to API models (times)."""

from __future__ import annotations

from typing import Any

from tcs.analysis.engine import Analysis, Occurrence
from tcs.analysis.types import Point
from tcs.api.schemas import (
    CoverageOut,
    FvgOut,
    LineOut,
    OccurrenceOut,
    OrderBlockOut,
    OutcomeOut,
    PointOut,
    RunOut,
    StructureOut,
    SummaryOut,
    ZoneOut,
)
from tcs.common.series import Series
from tcs.marketdata.history import Coverage


def _t(s: Series, i: int | None) -> int | None:
    return None if i is None else int(s.open_time[i])


def _point(s: Series, p: Point) -> PointOut:
    return PointOut(time=int(s.open_time[p.index]), price=p.price, label=p.label)


def occurrence(s: Series, o: Occurrence) -> OccurrenceOut:
    h = o.hit
    return OccurrenceOut(
        pattern=h.pattern,
        direction=h.direction,
        location=o.location,
        time=int(s.open_time[h.index]),
        start_time=int(s.open_time[h.start]),
        entry=h.entry,
        stop=h.stop,
        target=h.target,
        extreme=h.extreme,
        points=[_point(s, p) for p in h.points],
        lines=[LineOut(a=_point(s, ln.a), b=_point(s, ln.b), label=ln.label) for ln in h.lines],
        outcome=OutcomeOut(
            result=o.outcome.result,
            exit_time=_t(s, o.outcome.exit_index),
            move_pct=o.outcome.move_pct,
            r=o.outcome.r,
            bars=o.outcome.bars,
        ),
    )


def levels(a: Analysis) -> dict[str, Any]:
    s = a.level_series
    lv = a.levels
    return {
        "zones": [
            ZoneOut(
                kind=z.kind,
                low=z.low,
                high=z.high,
                start_time=int(s.open_time[z.start]),
                formed_time=int(s.open_time[z.formed]),
                end_time=_t(s, z.end),
                tests=z.tests,
                held=z.held,
                departure_atr=z.departure_atr,
            )
            for z in lv.zones
        ],
        "order_blocks": [
            OrderBlockOut(
                kind=b.kind,
                low=b.low,
                high=b.high,
                time=int(s.open_time[b.index]),
                formed_time=int(s.open_time[b.formed]),
                end_time=_t(s, b.end),
                mitigated_time=_t(s, b.mitigated),
                broke=b.broke,
            )
            for b in lv.order_blocks
        ],
        "fvgs": [
            FvgOut(
                kind=g.kind,
                low=g.low,
                high=g.high,
                time=int(s.open_time[g.index]),
                formed_time=int(s.open_time[g.formed]),
                filled_time=_t(s, g.filled),
            )
            for g in lv.fvgs
        ],
        "structure": [
            StructureOut(
                kind=b.kind,
                direction=b.direction,
                level=b.level,
                swing_time=int(s.open_time[b.swing_index]),
                time=int(s.open_time[b.index]),
            )
            for b in lv.structure
        ],
    }


def coverage(c: Coverage) -> CoverageOut:
    return CoverageOut(
        first=c.first,
        last=c.last,
        count=c.count,
        expected_last=c.expected_last,
        behind=c.behind,
        gaps=c.gaps,
        rest_ok=c.rest_ok,
    )


def summary(d: dict[str, Any] | None) -> SummaryOut | None:
    return None if d is None else SummaryOut.model_validate(d)


def run(r: dict[str, Any] | None) -> RunOut | None:
    if r is None:
        return None
    m = r["meta"]
    return RunOut(
        status=r["status"],
        started_at=r["started_at"],
        finished_at=r["finished_at"],
        coins=m.get("coins", []),
        done=m.get("done", 0),
        failed=m.get("failed", []),
        since=m.get("since", 0),
        until=m.get("until"),
        candles=m.get("candles", 0),
        days=m.get("days", 0),
    )
