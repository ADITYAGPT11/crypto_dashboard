"""Order-book depth recording: book sync, minute columns, the recorder end to end, the API."""

from __future__ import annotations

import asyncio
import contextlib
import json
import math
from collections.abc import AsyncGenerator, AsyncIterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tcs.api.app import create_app
from tcs.api.service import Service
from tcs.config import Settings
from tcs.depth.books import (
    BinanceBookSync,
    LocalBook,
    OkxBookSync,
    far_book,
    parse_binance_diff,
    parse_okx_book,
)
from tcs.depth.recorder import DepthRecorder
from tcs.depth.sampler import MinuteSampler, nice_step, stable_bucket
from tcs.store.sqlite import Store


def diff(first: int, last: int, prev: int, b: list[list[str]], a: list[list[str]]) -> Any:
    return {"data": {"e": "depthUpdate", "U": first, "u": last, "pu": prev, "b": b, "a": a}}


# Books ----------------------------------------------------------------------


def test_binance_sync_follows_the_documented_procedure() -> None:
    s = BinanceBookSync()
    early = parse_binance_diff(diff(90, 95, 89, [["99", "1"]], []))
    straddle = parse_binance_diff(diff(99, 102, 95, [["100", "2"]], [["101", "1"]]))
    nxt = parse_binance_diff(diff(103, 104, 102, [["100", "0"]], []))
    assert early and straddle and nxt
    assert s.diff(early) == "buffered"
    assert s.diff(straddle) == "buffered"
    # Snapshot at 100: the early event is stale, the straddling one applies.
    assert s.snapshot(100, [(98.0, 5.0)], [(102.0, 1.0)]) == "applied"
    assert s.ready
    assert s.book.bids == {98.0: 5.0, 100.0: 2.0}
    assert s.diff(nxt) == "applied"
    assert 100.0 not in s.book.bids
    gap = parse_binance_diff(diff(110, 111, 109, [], []))
    assert gap and s.diff(gap) == "resync"


def test_binance_resyncs_when_the_stream_starts_after_the_snapshot() -> None:
    s = BinanceBookSync()
    s.snapshot(100, [(98.0, 1.0)], [(102.0, 1.0)])
    late = parse_binance_diff(diff(105, 106, 104, [], []))
    assert late and s.diff(late) == "resync"


def test_okx_sync_checks_sequence_and_multiplies_contracts() -> None:
    s = OkxBookSync()
    snap = parse_okx_book(
        {
            "action": "snapshot",
            "data": [{"seqId": 10, "bids": [["100", "3"]], "asks": [["101", "2"]]}],
        },
        0.01,
    )
    upd = parse_okx_book(
        {
            "action": "update",
            "data": [{"seqId": 11, "prevSeqId": 10, "bids": [["100", "0"]], "asks": []}],
        },
        0.01,
    )
    bad = parse_okx_book(
        {"action": "update", "data": [{"seqId": 13, "prevSeqId": 12, "bids": [], "asks": []}]}, 0.01
    )
    assert snap and upd and bad
    assert s.handle(upd) == "skipped"
    assert s.handle(snap) == "applied"
    assert s.book.bids == {100.0: pytest.approx(0.03)}
    assert s.handle(upd) == "applied" and not s.book.bids
    assert s.handle(bad) == "resync"
    assert parse_okx_book({"event": "subscribe"}, 1) is None


def test_delta_snapshot_in_base_units() -> None:
    from tcs.depth.books import parse_delta_l2

    b = parse_delta_l2(
        {"type": "l2_orderbook", "buy": [{"limit_price": "64800", "size": 3000}], "sell": []},
        0.001,
    )
    assert b is not None and b.bids == {64800.0: pytest.approx(3.0)}
    assert parse_delta_l2({"type": "subscriptions"}, 0.001) is None


def test_far_book_keeps_only_levels_beyond_the_live_books() -> None:
    deep = LocalBook()
    deep.bids.update({99.0: 9.0, 90.0: 1.0, 50.0: 2.0})
    deep.asks.update({101.0: 9.0, 150.0: 3.0})
    near = LocalBook()
    near.bids.update({99.0: 1.0, 95.0: 1.0})
    near.asks.update({101.0: 1.0, 110.0: 1.0})
    far = far_book(deep, [near])
    assert far.bids == {90.0: 1.0, 50.0: 2.0}
    assert far.asks == {150.0: 3.0}


# Sampler --------------------------------------------------------------------


def book(bids: dict[float, float], asks: dict[float, float]) -> LocalBook:
    b = LocalBook()
    b.bids.update(bids)
    b.asks.update(asks)
    return b


def test_nice_step_and_stable_bucket() -> None:
    assert nice_step(1.3) == 2
    assert nice_step(0.034) == pytest.approx(0.05)
    assert stable_bucket(10, 15) == 10
    assert stable_bucket(10, 25) == 25
    assert stable_bucket(None, 5) == 5


def test_minute_columns_average_samples_and_add_exchanges() -> None:
    s = MinuteSampler()
    # Two exchanges; within +-2% of the mid (100) they span 99..101 -> buckets of 0.02.
    a = book({50.0: 1.0, 99.0: 2.0}, {101.0: 1.0, 150.0: 1.0})
    b = book({99.0: 2.0}, {101.0: 1.0})
    assert s.sample([a, b], 0) is None
    a.bids[99.0] = 0.0  # second sample: half the liquidity at 99 on one exchange
    assert s.sample([a, b], 30_000) is None
    col = s.sample([a, b], 60_000)  # next minute closes the first
    assert col is not None
    assert col.time == 0 and col.samples == 2 and col.bucket == pytest.approx(0.02)
    k = math.floor(99 / col.bucket)
    # notional at 99: (2+2)*99 then (0+2)*99 -> average 3*99
    assert col.bids[k] == pytest.approx(3 * 99)
    assert col.mid == pytest.approx(100)
    last = s.flush()
    assert last is not None and last.time == 60_000 and last.samples == 1


def test_no_column_without_books() -> None:
    s = MinuteSampler()
    assert s.sample([], 0) is None
    assert s.flush() is None


# Recorder end to end ----------------------------------------------------------


class FakeSocket:
    def __init__(self, messages: list[Any]) -> None:
        self.messages = messages
        self.sent: list[str] = []

    async def send(self, message: str) -> None:
        self.sent.append(message)

    async def _iter(self) -> AsyncIterator[str]:
        for m in self.messages:
            await asyncio.sleep(0)
            yield json.dumps(m)
        await asyncio.Event().wait()  # stay connected

    def __aiter__(self) -> AsyncIterator[str]:
        return self._iter()


def fake_connect(sockets: dict[str, FakeSocket]) -> Any:
    @contextlib.asynccontextmanager
    async def connect(url: str) -> AsyncGenerator[FakeSocket]:
        key = "okx" if "okx" in url else "delta" if "delta" in url else "binance"
        yield sockets[key]

    return connect


async def fake_fetch(url: str, params: dict[str, str]) -> Any:
    if "delta" in url:
        return {"result": {"contract_value": "0.001"}}
    if "books-full" in url:  # OKX's deep book (contracts): levels beyond its live 99 / 101
        return {
            "data": [
                {
                    "bids": [["98.5", "500"], ["99", "999"], ["40", "500"]],
                    "asks": [["101.5", "500"], ["160", "500"]],
                }
            ]
        }
    if "depth" in url:
        return {
            "lastUpdateId": 100,
            "bids": [["99", "2"], ["50", "1"]],
            "asks": [["101", "1"], ["150", "1"]],
        }
    return {"data": [{"ctVal": "0.01"}]}


def test_recorder_adds_up_all_three_exchanges(tmp_path: Path) -> None:
    store = Store(tmp_path / "d.sqlite3")
    sockets = {
        "binance": FakeSocket([diff(99, 102, 95, [["98", "1"]], [])]),
        "okx": FakeSocket(
            [
                {"event": "subscribe"},
                {
                    "action": "snapshot",
                    "data": [{"seqId": 1, "bids": [["99", "100"]], "asks": [["101", "100"]]}],
                },
            ]
        ),
        "delta": FakeSocket(
            [
                {"type": "subscriptions"},
                {
                    "type": "l2_orderbook",
                    # 4 000 contracts x 0.001 = 4 at 99, and a stray order at $0.50.
                    "buy": [
                        {"limit_price": "99", "size": 4000},
                        {"limit_price": "0.5", "size": 9e9},
                    ],
                    "sell": [{"limit_price": "101", "size": 1000}],
                },
            ]
        ),
    }
    clock = {"t": 0}

    def now() -> int:
        clock["t"] += 20_000  # every sample moves the clock 20 s
        return clock["t"]

    async def run() -> DepthRecorder:
        rec = DepthRecorder(
            store,
            ("BTC-USDT",),
            connect=fake_connect(sockets),
            fetch_json=fake_fetch,
            now=now,
            sample_s=0.01,
            deep_s=0.005,
        )
        await rec.start()
        for _ in range(200):
            await asyncio.sleep(0.01)
            if len(store.depth("BTC-USDT", 0)) >= 2:
                break
        await rec.stop()
        return rec

    rec = asyncio.run(run())
    feeds = rec.books["BTC-USDT"].feeds
    assert all(f.state == "live" for f in feeds.values()), {k: f.error for k, f in feeds.items()}
    assert rec.books["BTC-USDT"].feeds["BINANCE"].state == "live"
    assert rec.books["BTC-USDT"].feeds["OKX"].state == "live"
    assert rec.books["BTC-USDT"].feeds["DELTA"].state == "live"
    assert json.loads(sockets["okx"].sent[0])["args"][0] == {
        "channel": "books",
        "instId": "BTC-USDT-SWAP",
    }
    cols = store.depth("BTC-USDT", 0)
    assert len(cols) >= 2
    c = cols[-1]
    k = lambda p: math.floor(p / c.bucket)  # noqa: E731
    # At 99 all three add up: Binance 2 + OKX 100 x 0.01 + Delta 4 000 x 0.001 = 7.
    assert c.bids[k(99)] == pytest.approx(7 * 99)
    assert c.bids[k(98)] == pytest.approx(98)  # Binance's diff
    # OKX's deep book adds only levels beyond its own live book (its 99 is ignored).
    assert c.bids[k(98.5)] == pytest.approx(5 * 98.5)
    assert c.asks[k(101.5)] == pytest.approx(5 * 101.5)
    # Nothing outside +-2% of the mid: not Binance's 50 / 150, the deep 40 / 160 or Delta's $0.50.
    lo, hi = k(c.mid * 0.98), k(c.mid * 1.02)
    assert all(lo <= key <= hi for key in [*c.bids, *c.asks])


def test_store_keeps_only_the_retention_window(tmp_path: Path) -> None:
    from tcs.depth.sampler import Column

    store = Store(tmp_path / "d.sqlite3")
    store.put_depth("BTC-USDT", Column(0, 1, 100, 1, {99: 5.0}, {101: 6.0}))
    store.put_depth("BTC-USDT", Column(120_000, 1, 100, 1, {99: 5.0}, {}), delete_before=60_000)
    assert [c.time for c in store.depth("BTC-USDT", 0)] == [120_000]


# API --------------------------------------------------------------------------


def test_depth_endpoint_serves_recorded_columns(tmp_path: Path) -> None:
    from tcs.api.service import now_ms
    from tcs.depth.sampler import Column

    settings = Settings(db_path=tmp_path / "a.sqlite3", record_depth=False)
    svc = Service(settings)
    t = now_ms() // 60_000 * 60_000 - 120_000
    svc.store.put_depth("ETH-USDT", Column(t, 0.5, 3000.0, 30, {6000: 1234.5}, {6002: 99.0}))
    client = TestClient(create_app(settings, svc))
    body = client.get("/api/v1/depth/eth-usdt", params={"minutes": 10}).json()
    assert body["symbol"] == "ETH-USDT"
    assert body["recording"] is False
    assert body["columns"] == [
        {
            "time": t,
            "bucket": 0.5,
            "mid": 3000.0,
            "samples": 30,
            "bids": [[6000, 1234.5]],
            "asks": [[6002, 99.0]],
        }
    ]
    assert client.get("/api/v1/depth/BTCUSDT").status_code == 422
