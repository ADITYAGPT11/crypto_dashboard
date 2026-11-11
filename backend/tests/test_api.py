import httpx
import pytest
from fastapi.testclient import TestClient

from tcs.api.app import create_app
from tcs.common.symbols import RESEARCH_UNIVERSE
from tcs.marketdata.candles import Candles
from tests.synthetic import crypto_candles


class FakeHistory:
    def __init__(self, failing: set[str] | None = None) -> None:
        self.failing = failing or set()

    async def load(self, symbol: str, interval: str) -> Candles:
        if symbol in self.failing:
            raise httpx.ConnectError("blocked")
        return crypto_candles(seed=sum(map(ord, symbol)), n=800, symbol=symbol)


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app(FakeHistory(failing={"LTC-USDT"})))


def test_health_and_catalog(client: TestClient) -> None:
    assert client.get("/health").json() == {"status": "ok"}
    names = {p["name"] for p in client.get("/patterns/catalog").json()}
    assert {"double_bottom", "hs_bottom", "hammer"} <= names


def test_patterns_lists_recent_events_with_brackets(client: TestClient) -> None:
    res = client.get("/patterns/btc-usdt/4h", params={"since_bars": 800})
    assert res.status_code == 200
    body = res.json()
    assert body["symbol"] == "BTC-USDT" and body["candles"] == 800
    assert body["bracket"]["break_even"] == pytest.approx(1 / 3)
    assert body["events"], "fixture should produce chart patterns"
    assert {e["kind"] for e in body["events"]} == {"chart"}
    e = body["events"][0]
    sign = 1 if e["direction"] == "bullish" else -1
    assert sign * (e["target"] - e["entry"]) == pytest.approx(2 * e["atr"])
    assert sign * (e["entry"] - e["stop"]) == pytest.approx(e["atr"])
    assert all(x["open_time"] >= body["last_open_time"] - 2 * 14_400_000 for x in body["current"])


def test_stats_pool_universe_and_report_unavailable(client: TestClient) -> None:
    res = client.get("/patterns/BTC-USDT/4h/stats", params={"patterns": "double_bottom"})
    assert res.status_code == 200
    body = res.json()
    assert "LTC-USDT" in body["unavailable"]
    assert len(body["symbols"]) == len(RESEARCH_UNIVERSE) - 1
    (row,) = [r for r in body["stats"] if r["direction"] == "bullish"]
    assert row["pattern"] == "double_bottom"
    assert row["pooled"]["n"] >= row["own"]["n"] > 0
    assert row["pooled"]["ci_low"] <= row["pooled"]["win_rate"] <= row["pooled"]["ci_high"]
    assert len(row["recent"]) <= 20
    times = [e["open_time"] for e in row["recent"]]
    assert times == sorted(times, reverse=True)


def test_bad_input_and_upstream_failure() -> None:
    c = TestClient(create_app(FakeHistory(failing={"BTC-USDT"})))
    assert c.get("/patterns/BTC-USDT/7h").status_code == 422
    assert c.get("/patterns/BTCUSDT/4h").status_code == 422
    assert c.get("/patterns/ETH-USDT/4h", params={"kinds": "nope"}).status_code == 422
    assert c.get("/patterns/ETH-USDT/4h/stats", params={"patterns": "nope"}).status_code == 422
    assert c.get("/patterns/BTC-USDT/4h").status_code == 502
