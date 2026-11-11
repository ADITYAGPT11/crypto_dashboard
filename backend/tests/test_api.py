"""The API and the statistics job end to end, on synthetic candles (no network)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tcs.api.app import create_app
from tcs.api.service import Service
from tcs.common.series import Candle
from tcs.common.timeframes import TF_MS, Timeframe
from tcs.config import Settings
from tcs.jobs import stats_job
from tcs.marketdata.binance import SourceUnavailable
from tcs.marketdata.history import History
from tcs.store.sqlite import Store

from .helpers import random_walk

NOW = 1_794_400_000_000  # 2026-11-10


class FakeSource:
    """Serves a deterministic random walk per (symbol, tf) through the REST call only."""

    rest_available = True

    def rest(self, symbol: str, tf: Timeframe, start: int, end: int) -> list[Candle]:
        seed = sum(map(ord, symbol + tf))
        n = (end - start) // TF_MS[tf] + 1
        walk = random_walk(seed, n=n, tf=tf)
        return [
            Candle(start + i * TF_MS[tf], c.open, c.high, c.low, c.close, c.volume)
            for i, c in enumerate(walk.candles())
        ]

    def archive_month(self, *_: object) -> list[Candle] | None:
        raise SourceUnavailable("offline")

    def archive_day(self, *_: object) -> list[Candle] | None:
        raise SourceUnavailable("offline")


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(
        db_path=tmp_path / "t.sqlite3",
        stats_days=120,
        universe=("AAA-USDT", "BBB-USDT"),
        schedule=False,
    )


@pytest.fixture
def client(settings: Settings, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    store = Store(settings.db_path)
    history = History(store, FakeSource())  # type: ignore[arg-type]
    monkeypatch.setattr(stats_job, "History", lambda s: History(s, FakeSource()))  # type: ignore[arg-type]
    monkeypatch.setattr("tcs.api.service.now_ms", lambda: NOW)
    stats_job.run_stats(settings, "4h", now=NOW)
    return TestClient(create_app(settings, Service(settings, store, history)))


def test_stats_job_pools_every_coin_and_location(client: TestClient) -> None:
    body = client.get("/api/v1/stats", params={"tf": "4h", "zoneTf": "1d"}).json()
    assert body["run"]["status"] == "done"
    assert body["run"]["done"] == 2 and body["run"]["failed"] == []
    setups = body["setups"]
    assert setups, "no setups measured"
    locations = {s["location"] for s in setups}
    assert "*" in locations
    for s in setups:
        m = s["summary"]
        assert m["wins"] + m["losses"] == m["n"]
        assert 0 <= m["ciLow"] <= m["winRate"] <= m["ciHigh"] <= 1
    # Pooled "any location" equals the sum over locations.
    by = {(s["pattern"], s["direction"], s["location"]): s["summary"]["n"] for s in setups}
    for (p, d, loc), n in by.items():
        if loc == "*":
            assert n == sum(v for (p2, d2, l2), v in by.items() if (p2, d2) == (p, d) and l2 != "*")


def test_setup_detail_has_per_coin_rows_and_recent_cases(client: TestClient) -> None:
    stats: list[dict[str, Any]] = client.get("/api/v1/stats", params={"tf": "4h"}).json()["setups"]
    top = max((s for s in stats if s["location"] == "*"), key=lambda s: int(s["summary"]["n"]))
    body = client.get(
        "/api/v1/stats/setup",
        params={"tf": "4h", "pattern": top["pattern"], "direction": top["direction"]},
    ).json()
    assert body["pooled"]["n"] == top["summary"]["n"]
    assert sum(c["summary"]["n"] for c in body["perCoin"]) == top["summary"]["n"]
    assert all(c["result"] in ("win", "loss") for c in body["recent"])


def test_chart_analysis_uses_the_same_rules_as_the_job(client: TestClient) -> None:
    a = client.get("/api/v1/analysis/AAA-USDT", params={"tf": "4h", "limit": 400}).json()
    assert a["ruleset"] == client.get("/api/v1/patterns").json()["ruleset"]
    assert a["coverage"]["behind"] == 0
    assert a["occurrences"]
    o = a["occurrences"][0]
    assert {"pattern", "direction", "location", "entry", "stop", "target", "outcome"} <= o.keys()
    assert o["startTime"] <= o["time"]


def test_scanner_attaches_pooled_record(client: TestClient) -> None:
    body = client.get("/api/v1/scanner", params={"tf": "4h", "bars": 20}).json()
    assert body["failed"] == []
    for item in body["items"]:
        assert item["symbol"] in ("AAA-USDT", "BBB-USDT")


def test_rejects_bad_input(client: TestClient) -> None:
    assert client.get("/api/v1/analysis/btc", params={"tf": "4h"}).status_code == 422
    assert client.get("/api/v1/analysis/BTC-USDT", params={"tf": "3h"}).status_code == 422
    r = client.get("/api/v1/analysis/BTC-USDT", params={"tf": "1d", "zoneTf": "4h"})
    assert r.status_code == 422
    assert (
        client.get("/api/v1/stats/setup", params={"pattern": "x", "direction": "long"}).status_code
        == 422
    )
