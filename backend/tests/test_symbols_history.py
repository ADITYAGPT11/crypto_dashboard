import asyncio

import pytest

from tcs.common.symbols import next_close, normalize_symbol, to_binance
from tcs.marketdata.binance_history import PAGE_LIMIT, BinanceHistory, parse_klines

H4 = 14_400_000


def test_symbols() -> None:
    assert normalize_symbol("btc-usdt") == "BTC-USDT" and to_binance("ETH-USDT") == "ETHUSDT"
    with pytest.raises(ValueError):
        normalize_symbol("BTCUSDT")


def test_weekly_close_is_monday() -> None:
    monday = 1_730_678_400_000  # 2024-11-04 00:00 UTC
    assert next_close(monday + 1, "1w") == monday + 7 * 86_400_000


def test_parse_skips_malformed_rows() -> None:
    raw = [[1, "1", "2", "0.5", "1.5", "10", 0], ["x"], [2, "a", "2", "1", "1", "1"]]
    assert parse_klines(raw) == [(1, 1.0, 2.0, 0.5, 1.5, 10.0)]
    assert parse_klines({"code": -1}) == []


def _row(t: int) -> list[object]:
    return [t, "1", "2", "0.5", "1.5", "10"]


def test_pages_backwards_drops_forming_candle_and_caches_until_next_close() -> None:
    now = {"t": 3000 * H4 + 5}  # candle 3000 is forming
    calls: list[dict[str, str | int]] = []

    async def fetcher(url: str, params: dict[str, str | int]) -> object:
        calls.append(dict(params))
        end = int(params.get("endTime", now["t"]))
        last = end // H4
        return [_row(i * H4) for i in range(max(0, last - PAGE_LIMIT + 1), last + 1)]

    h = BinanceHistory(fetcher=fetcher, clock=lambda: now["t"], pages=2)

    c = asyncio.run(h.load("BTC-USDT", "4h"))
    assert len(c) == 2 * PAGE_LIMIT - 1  # 1,501..3,000 + 1..1,500 minus the forming one
    assert c.open_time[-1] == 2999 * H4 and (c.open_time[1:] > c.open_time[:-1]).all()
    assert calls[0]["symbol"] == "BTCUSDT" and calls[1]["endTime"] == (3000 - 1499) * H4 - 1

    async def twice() -> None:
        await h.load("BTC-USDT", "4h")
        now["t"] = 3001 * H4 + 1  # the forming candle closed
        await h.load("BTC-USDT", "4h")

    asyncio.run(twice())
    assert len(calls) == 4  # one cached call, then a refetch (2 pages)
