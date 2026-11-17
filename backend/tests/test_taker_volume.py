"""Taker buy volume: parsed from Binance klines, stored, sliced and mirrored."""

from __future__ import annotations

import math
import sqlite3
from pathlib import Path

import numpy as np

from tcs.common.series import Candle, Series, mirror
from tcs.marketdata.binance import _row  # pyright: ignore[reportPrivateUsage]
from tcs.store.sqlite import Store

# Binance kline: open time, o, h, l, c, volume, close time, quote volume, trades,
# taker buy base volume, taker buy quote volume, ignore.
REST_ROW: list[str | float | int] = [
    1_700_000_000_000,
    "10",
    "12",
    "9",
    "11",
    "100",
    1_700_003_599_999,
    "1100",
    42,
    "60",
    "660",
    "0",
]


def test_rest_and_archive_rows_parse_taker_buy() -> None:
    assert _row(REST_ROW).taker_buy == 60.0
    archive = [
        "1700000000000",
        "10",
        "12",
        "9",
        "11",
        "100",
        "1700003599999",
        "1100",
        "42",
        "60",
        "660",
        "0",
    ]
    assert _row(archive).taker_buy == 60.0


def test_short_row_has_unknown_taker_buy() -> None:
    assert math.isnan(_row(REST_ROW[:6]).taker_buy)


def test_store_round_trips_known_and_unknown_taker_buy(tmp_path: Path) -> None:
    store = Store(tmp_path / "t.sqlite3")
    store.put_candles(
        "AAA-USDT",
        "1h",
        [Candle(0, 1, 2, 0.5, 1.5, 10, 4), Candle(3_600_000, 1.5, 2, 1, 1.8, 8)],
    )
    s = store.series("AAA-USDT", "1h")
    assert s.taker_buy is not None
    assert s.taker_buy[0] == 4
    assert math.isnan(s.taker_buy[1])


def test_old_store_gains_the_column_and_refetches_candles(tmp_path: Path) -> None:
    path = tmp_path / "old.sqlite3"
    with sqlite3.connect(path) as db:
        db.execute(
            "CREATE TABLE candles (symbol TEXT NOT NULL, tf TEXT NOT NULL, "
            "open_time INTEGER NOT NULL, open REAL NOT NULL, high REAL NOT NULL, "
            "low REAL NOT NULL, close REAL NOT NULL, volume REAL NOT NULL, "
            "PRIMARY KEY (symbol, tf, open_time)) WITHOUT ROWID"
        )
        db.execute("INSERT INTO candles VALUES ('AAA-USDT','1h',0,1,2,0.5,1.5,10)")
    store = Store(path)
    assert store.candle_range("AAA-USDT", "1h") is None
    store.put_candles("AAA-USDT", "1h", [Candle(0, 1, 2, 0.5, 1.5, 10, 4)])
    s = store.series("AAA-USDT", "1h")
    assert s.taker_buy is not None and s.taker_buy[0] == 4


def test_slice_and_mirror_keep_taker_volume_aligned() -> None:
    s = Series.from_candles(
        "AAA-USDT", "1h", [Candle(i * 3_600_000, 1, 2, 0.5, 1.5, 10, float(i)) for i in range(5)]
    )
    assert s.slice(1, 3).taker_buy is not None
    assert list(s.slice(1, 3).taker_buy) == [1.0, 2.0]  # type: ignore[arg-type]
    # Aggressive buyers of the mirrored series are the sellers of the original.
    m = mirror(s)
    assert m.taker_buy is not None
    np.testing.assert_allclose(m.taker_buy, 10 - np.arange(5.0))
    assert mirror(m).taker_buy is not None
    np.testing.assert_allclose(mirror(m).taker_buy, s.taker_buy)  # type: ignore[arg-type]
