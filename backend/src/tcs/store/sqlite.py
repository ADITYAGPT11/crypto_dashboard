"""SQLite storage: candles and recorded order-book depth.

Interim store until the QuestDB collector lands (DECISIONS 2026-11-11): zero setup,
one file, WAL mode so the API reads while the depth recorder writes.
"""

from __future__ import annotations

import json
import math
import sqlite3
import threading
from collections.abc import Generator, Iterable
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import numpy as np

from tcs.common.series import Candle, Series
from tcs.common.timeframes import Timeframe
from tcs.depth.sampler import Column

SCHEMA = """
CREATE TABLE IF NOT EXISTS candles (
  symbol TEXT NOT NULL, tf TEXT NOT NULL, open_time INTEGER NOT NULL,
  open REAL NOT NULL, high REAL NOT NULL, low REAL NOT NULL, close REAL NOT NULL,
  volume REAL NOT NULL, taker_buy REAL,
  PRIMARY KEY (symbol, tf, open_time)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS depth_columns (
  symbol TEXT NOT NULL, time INTEGER NOT NULL,
  bucket REAL NOT NULL, mid REAL NOT NULL, samples INTEGER NOT NULL,
  bids TEXT NOT NULL, asks TEXT NOT NULL,
  PRIMARY KEY (symbol, time)
) WITHOUT ROWID;
"""

#: Tables of removed features (funding history, setup statistics; DECISIONS 2026-11-22),
#: dropped from stores made before.
OBSOLETE_TABLES = ("funding", "funding_months", "stats_runs", "setup_stats", "setup_cases")


def _migrate(db: sqlite3.Connection) -> None:
    """Stores made before taker volume was kept: add the column and drop the cached candles.

    Candles are a cache of Binance's public archive, so they are downloaded again (with taker
    volume) the next time a chart asks for them. Tables of removed features are dropped.
    """
    cols = {row[1] for row in db.execute("PRAGMA table_info(candles)")}
    if "taker_buy" not in cols:
        db.execute("ALTER TABLE candles ADD COLUMN taker_buy REAL")
        db.execute("DELETE FROM candles")
    for table in OBSOLETE_TABLES:
        db.execute(f"DROP TABLE IF EXISTS {table}")


class Store:
    """Thread-safe: one connection per thread, all on the same database file."""

    def __init__(self, path: Path | str) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._local = threading.local()
        with self.tx() as db:
            db.executescript(SCHEMA)
            _migrate(db)

    def _conn(self) -> sqlite3.Connection:
        conn: sqlite3.Connection | None = getattr(self._local, "conn", None)
        if conn is None:
            conn = sqlite3.connect(self.path, timeout=60)
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA synchronous=NORMAL")
            self._local.conn = conn
        return conn

    @contextmanager
    def tx(self) -> Generator[sqlite3.Connection]:
        conn = self._conn()
        with conn:
            yield conn

    # Candles -----------------------------------------------------------------

    def put_candles(self, symbol: str, tf: Timeframe, candles: Iterable[Candle]) -> int:
        rows = [
            (
                symbol,
                tf,
                c.open_time,
                c.open,
                c.high,
                c.low,
                c.close,
                c.volume,
                None if math.isnan(c.taker_buy) else c.taker_buy,
            )
            for c in candles
        ]
        with self.tx() as db:
            db.executemany("INSERT OR REPLACE INTO candles VALUES (?,?,?,?,?,?,?,?,?)", rows)
        return len(rows)

    def candle_range(self, symbol: str, tf: Timeframe) -> tuple[int, int, int] | None:
        """(first open time, last open time, count) or None when nothing is stored."""
        row = (
            self._conn()
            .execute(
                "SELECT MIN(open_time), MAX(open_time), COUNT(*) FROM candles WHERE symbol=? AND tf=?",
                (symbol, tf),
            )
            .fetchone()
        )
        return None if row is None or row[0] is None else (int(row[0]), int(row[1]), int(row[2]))

    def series(
        self, symbol: str, tf: Timeframe, since: int | None = None, until: int | None = None
    ) -> Series:
        sql = (
            "SELECT open_time, open, high, low, close, volume, taker_buy"
            " FROM candles WHERE symbol=? AND tf=?"
        )
        args: list[Any] = [symbol, tf]
        if since is not None:
            sql += " AND open_time >= ?"
            args.append(since)
        if until is not None:
            sql += " AND open_time <= ?"
            args.append(until)
        rows = self._conn().execute(sql + " ORDER BY open_time", args).fetchall()
        # NULL taker volume (not stored) becomes NaN.
        arr = np.array(rows, dtype=np.float64).reshape(-1, 7)
        return Series(
            symbol,
            tf,
            arr[:, 0].astype(np.int64),
            arr[:, 1].copy(),
            arr[:, 2].copy(),
            arr[:, 3].copy(),
            arr[:, 4].copy(),
            arr[:, 5].copy(),
            arr[:, 6].copy(),
        )

    # Funding rates -------------------------------------------------------------

    def put_depth(self, symbol: str, col: Column, delete_before: int | None = None) -> None:
        """Store one minute column; drop this symbol's columns older than ``delete_before``."""
        side = lambda m: json.dumps([[k, round(v, 2)] for k, v in sorted(m.items())])  # noqa: E731
        with self.tx() as db:
            db.execute(
                "INSERT OR REPLACE INTO depth_columns VALUES (?,?,?,?,?,?,?)",
                (
                    symbol,
                    col.time,
                    col.bucket,
                    col.mid,
                    col.samples,
                    side(col.bids),
                    side(col.asks),
                ),
            )
            if delete_before is not None:
                db.execute(
                    "DELETE FROM depth_columns WHERE symbol=? AND time < ?", (symbol, delete_before)
                )

    def depth(self, symbol: str, since: int, until: int | None = None) -> list[Column]:
        sql = (
            "SELECT time, bucket, mid, samples, bids, asks FROM depth_columns "
            "WHERE symbol=? AND time >= ?"
        )
        args: list[Any] = [symbol, since]
        if until is not None:
            sql += " AND time <= ?"
            args.append(until)
        rows = self._conn().execute(sql + " ORDER BY time", args).fetchall()
        return [
            Column(
                int(r[0]),
                float(r[1]),
                float(r[2]),
                int(r[3]),
                {int(k): float(v) for k, v in json.loads(r[4])},
                {int(k): float(v) for k, v in json.loads(r[5])},
            )
            for r in rows
        ]
