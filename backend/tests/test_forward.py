"""Forward paper trading: only setups known after the start count, closed trades are frozen."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tcs.api.app import create_app
from tcs.api.schemas import PlaybookLiveOut
from tcs.api.service import Service
from tcs.config import Settings

M15 = 900_000


def trade(
    status: str, r: float = 0.0, fill: int | None = None, exit_t: int | None = None
) -> dict[str, Any]:
    return {
        "entryKind": "fvg",
        "exitKind": "trail",
        "status": status,
        "note": "",
        "entry": 100.0,
        "stop": 98.0,
        "target": None,
        "fillTime": fill,
        "exitTime": exit_t,
        "exitPrice": 101.0 if exit_t else None,
        "reason": "trail" if exit_t else None,
        "stopNow": 99.0,
        "rNet": r,
        "rGross": r + 0.1 if exit_t else 0.0,
    }


def trigger(time: int, known: int, trades: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "pattern": "bullishEngulfing",
        "direction": "long",
        "location": "zone",
        "time": time,
        "knownAt": known,
        "windowEnd": known + 6 * 4 * 3_600_000,
        "stage": "confirmed",
        "htfStop": 95.0,
        "htfTarget": 110.0,
        "chochTime": known + M15,
        "broke": 99.5,
        "impulseLow": 98.2,
        "impulseHigh": 100.5,
        "trades": trades,
    }


def live(triggers: list[dict[str, Any]]) -> PlaybookLiveOut:
    cov = {
        "first": 0,
        "last": 0,
        "count": 0,
        "expectedLast": 0,
        "behind": 0,
        "gaps": 0,
        "restOk": True,
    }
    return PlaybookLiveOut.model_validate(
        {
            "symbol": "AAA-USDT",
            "htf": "4h",
            "ltf": "15m",
            "ruleset": "x",
            "coverage": cov,
            "ltfCoverage": cov,
            "triggers": triggers,
        }
    )


@pytest.fixture
def svc(tmp_path: Path) -> Service:
    return Service(
        Settings(
            db_path=tmp_path / "f.sqlite3",
            universe=("AAA-USDT",),
            playbook_universe=("AAA-USDT",),
            schedule=False,
            record_depth=False,
        )
    )


def test_forward_counts_only_new_setups_and_freezes_closed_trades(
    svc: Service, monkeypatch: pytest.MonkeyPatch
) -> None:
    feed: list[PlaybookLiveOut] = [
        live([]),  # first run: tracking starts at t = 1 000 000
        # A setup known before the start (ignored) and one known after it (recorded, open).
        live(
            [
                trigger(0, 900_000, [trade("closed", 2.0, 950_000, 990_000)]),
                trigger(1_000_000, 2_000_000, [trade("open", 0.0, 3_000_000)]),
            ]
        ),
        live([trigger(1_000_000, 2_000_000, [trade("closed", -1.1, 3_000_000, 4_000_000)])]),
        # The data later says something else about the closed trade: it stays as recorded.
        live([trigger(1_000_000, 2_000_000, [trade("closed", 3.0, 3_000_000, 4_500_000)])]),
    ]
    calls = iter(feed)
    monkeypatch.setattr(svc, "playbook_live", lambda *a, **k: next(calls))  # type: ignore[misc]

    assert svc.record_forward(now=1_000_000)["started"] == 1_000_000
    svc.record_forward(now=3_500_000)
    out = svc.forward("4h", "15m", "fvg", "trail")
    assert out.started_at == 1_000_000 and out.signals == 1
    assert [(t.time, t.status) for t in out.trades] == [(1_000_000, "open")]
    assert out.trades[0].late is False  # first seen 3 500 000, fill 3 000 000: within a candle

    svc.record_forward(now=5_000_000)
    svc.record_forward(now=6_000_000)
    (t,) = svc.forward("4h", "15m", "fvg", "trail").trades
    assert t.status == "closed" and t.r_net == -1.1 and t.exit_time == 4_000_000
    assert t.first_seen == 3_500_000


def test_late_flag_when_the_server_saw_the_trade_after_its_entry(
    svc: Service, monkeypatch: pytest.MonkeyPatch
) -> None:
    feed = iter([live([]), live([trigger(1_000_000, 2_000_000, [trade("open", 0.0, 2_100_000)])])])
    monkeypatch.setattr(svc, "playbook_live", lambda *a, **k: next(feed))  # type: ignore[misc]
    svc.record_forward(now=1_000_000)
    svc.record_forward(now=2_100_000 + 3 * M15)  # down for three candles after the fill
    (t,) = svc.forward("4h", "15m", "fvg", "trail").trades
    assert t.late is True


def test_forward_endpoint(svc: Service) -> None:
    client = TestClient(create_app(svc.settings, svc))
    body = client.get("/api/v1/paper/forward", params={"entry": "fvg", "exit": "trail"}).json()
    assert body["startedAt"] is None and body["trades"] == []
    assert (
        client.get("/api/v1/paper/forward", params={"entry": "x", "exit": "y"}).status_code == 422
    )
