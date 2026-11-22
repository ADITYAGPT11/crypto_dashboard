"""The API end to end, on synthetic candles (no network)."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from tcs.api.app import create_app
from tcs.api.service import Service
from tcs.common.series import Candle
from tcs.common.timeframes import TF_MS, Timeframe
from tcs.config import Settings
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
            Candle(
                start + i * TF_MS[tf],
                c.open,
                c.high,
                c.low,
                c.close,
                c.volume,
                c.volume * (0.3 + 0.04 * ((i * 7) % 10)),
            )
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
        universe=("AAA-USDT", "BBB-USDT"),
        record_depth=False,
    )


@pytest.fixture
def client(settings: Settings, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    store = Store(settings.db_path)
    history = History(store, FakeSource())  # type: ignore[arg-type]
    monkeypatch.setattr("tcs.api.service.now_ms", lambda: NOW)
    return TestClient(create_app(settings, Service(settings, store, history)))


def test_candles_carry_taker_buy_volume(client: TestClient) -> None:
    body = client.get("/api/v1/candles/AAA-USDT", params={"tf": "4h", "limit": 50}).json()
    rows = body["candles"]
    assert len(rows) == 50
    for row in rows:
        assert len(row) == 7
        assert 0.3 * row[5] <= row[6] <= 0.7 * row[5]


def test_chart_analysis_carries_each_patterns_checklist(client: TestClient) -> None:
    a = client.get("/api/v1/analysis/AAA-USDT", params={"tf": "4h", "limit": 400}).json()
    assert a["ruleset"] == client.get("/api/v1/patterns").json()["ruleset"]
    assert a["coverage"]["behind"] == 0
    assert a["occurrences"]
    o = a["occurrences"][0]
    assert {"pattern", "direction", "location", "close", "score", "checks"} <= o.keys()
    assert not {"entry", "stop", "target", "outcome", "trail", "confidence"} & o.keys()
    assert o["startTime"] <= o["time"]
    max_score = client.get("/api/v1/patterns").json()["maxScore"]
    for occ in a["occurrences"]:
        assert [c["id"] for c in occ["checks"]] == [
            "location",
            "rsi",
            "volume",
            "vwap",
            "atr",
            "supertrend",
        ]
        assert occ["score"] == sum(c["passed"] for c in occ["checks"]) <= max_score


def test_scanner_lists_recent_setups_best_checklist_first(client: TestClient) -> None:
    body = client.get("/api/v1/scanner", params={"tf": "4h", "bars": 20}).json()
    assert body["failed"] == []
    items = body["items"]
    for item in items:
        assert item["symbol"] in ("AAA-USDT", "BBB-USDT")
        assert set(item) == {"symbol", "occurrence"}
    scores = [i["occurrence"]["score"] for i in items]
    assert scores == sorted(scores, reverse=True)


def test_no_statistics_endpoints_remain(client: TestClient) -> None:
    for path in ("/api/v1/stats", "/api/v1/stats/setup"):
        assert client.get(path).status_code == 404
    assert "runs" not in client.get("/api/v1/health").json()


def test_rejects_bad_input(client: TestClient) -> None:
    assert client.get("/api/v1/analysis/btc", params={"tf": "4h"}).status_code == 422
    assert client.get("/api/v1/analysis/BTC-USDT", params={"tf": "3h"}).status_code == 422
    r = client.get("/api/v1/analysis/BTC-USDT", params={"tf": "1d", "zoneTf": "4h"})
    assert r.status_code == 422
