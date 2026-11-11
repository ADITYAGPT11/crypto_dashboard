"""SQLite storage: candles and setup statistics.

Interim store until the QuestDB collector lands (DECISIONS 2026-11-11): zero setup,
one file, WAL mode so the API reads while the statistics job writes.
"""

from __future__ import annotations

import json
import sqlite3
import threading
from collections.abc import Generator, Iterable, Sequence
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import numpy as np

from tcs.common.series import Candle, Series
from tcs.common.timeframes import Timeframe

SCHEMA = """
CREATE TABLE IF NOT EXISTS candles (
  symbol TEXT NOT NULL, tf TEXT NOT NULL, open_time INTEGER NOT NULL,
  open REAL NOT NULL, high REAL NOT NULL, low REAL NOT NULL, close REAL NOT NULL,
  volume REAL NOT NULL,
  PRIMARY KEY (symbol, tf, open_time)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS stats_runs (
  ruleset TEXT NOT NULL, tf TEXT NOT NULL,
  status TEXT NOT NULL, started_at INTEGER NOT NULL, finished_at INTEGER,
  meta TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (ruleset, tf)
);

CREATE TABLE IF NOT EXISTS setup_stats (
  ruleset TEXT NOT NULL, tf TEXT NOT NULL, zone_tf TEXT NOT NULL, symbol TEXT NOT NULL,
  pattern TEXT NOT NULL, direction TEXT NOT NULL, location TEXT NOT NULL,
  summary TEXT NOT NULL,
  PRIMARY KEY (ruleset, tf, zone_tf, symbol, pattern, direction, location)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS setup_cases (
  ruleset TEXT NOT NULL, tf TEXT NOT NULL, zone_tf TEXT NOT NULL, symbol TEXT NOT NULL,
  pattern TEXT NOT NULL, direction TEXT NOT NULL, location TEXT NOT NULL,
  time INTEGER NOT NULL, result TEXT NOT NULL, detail TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS setup_cases_key
  ON setup_cases (ruleset, tf, zone_tf, pattern, direction, location, time);
"""


class Store:
    """Thread-safe: one connection per thread, all on the same database file."""

    def __init__(self, path: Path | str) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._local = threading.local()
        with self.tx() as db:
            db.executescript(SCHEMA)

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
            (symbol, tf, c.open_time, c.open, c.high, c.low, c.close, c.volume) for c in candles
        ]
        with self.tx() as db:
            db.executemany("INSERT OR REPLACE INTO candles VALUES (?,?,?,?,?,?,?,?)", rows)
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
            "SELECT open_time, open, high, low, close, volume FROM candles WHERE symbol=? AND tf=?"
        )
        args: list[Any] = [symbol, tf]
        if since is not None:
            sql += " AND open_time >= ?"
            args.append(since)
        if until is not None:
            sql += " AND open_time <= ?"
            args.append(until)
        rows = self._conn().execute(sql + " ORDER BY open_time", args).fetchall()
        arr = np.array(rows, dtype=np.float64).reshape(-1, 6)
        return Series(
            symbol,
            tf,
            arr[:, 0].astype(np.int64),
            arr[:, 1].copy(),
            arr[:, 2].copy(),
            arr[:, 3].copy(),
            arr[:, 4].copy(),
            arr[:, 5].copy(),
        )

    # Statistics --------------------------------------------------------------

    def start_run(self, ruleset: str, tf: Timeframe, now: int, meta: dict[str, Any]) -> None:
        with self.tx() as db:
            db.execute(
                "INSERT OR REPLACE INTO stats_runs VALUES (?,?,?,?,?,?)",
                (ruleset, tf, "running", now, None, json.dumps(meta)),
            )

    def update_run(self, ruleset: str, tf: Timeframe, meta: dict[str, Any]) -> None:
        with self.tx() as db:
            db.execute(
                "UPDATE stats_runs SET meta=? WHERE ruleset=? AND tf=?",
                (json.dumps(meta), ruleset, tf),
            )

    def finish_run(
        self, ruleset: str, tf: Timeframe, now: int, status: str, meta: dict[str, Any]
    ) -> None:
        with self.tx() as db:
            db.execute(
                "UPDATE stats_runs SET status=?, finished_at=?, meta=? WHERE ruleset=? AND tf=?",
                (status, now, json.dumps(meta), ruleset, tf),
            )

    def run(self, ruleset: str, tf: Timeframe) -> dict[str, Any] | None:
        row = (
            self._conn()
            .execute(
                "SELECT status, started_at, finished_at, meta FROM stats_runs WHERE ruleset=? AND tf=?",
                (ruleset, tf),
            )
            .fetchone()
        )
        if row is None:
            return None
        return {
            "status": row[0],
            "started_at": row[1],
            "finished_at": row[2],
            "meta": json.loads(row[3]),
        }

    def replace_stats(
        self,
        ruleset: str,
        tf: Timeframe,
        stats: Sequence[tuple[str, str, str, str, str, dict[str, Any]]],
        cases: Sequence[tuple[str, str, str, str, str, int, str, dict[str, Any]]],
    ) -> None:
        """Swap in a finished run's results atomically (readers never see half a run)."""
        with self.tx() as db:
            db.execute("DELETE FROM setup_stats WHERE ruleset=? AND tf=?", (ruleset, tf))
            db.execute("DELETE FROM setup_cases WHERE ruleset=? AND tf=?", (ruleset, tf))
            db.executemany(
                "INSERT INTO setup_stats VALUES (?,?,?,?,?,?,?,?)",
                [(ruleset, tf, z, sym, p, d, loc, json.dumps(s)) for z, sym, p, d, loc, s in stats],
            )
            db.executemany(
                "INSERT INTO setup_cases VALUES (?,?,?,?,?,?,?,?,?,?)",
                [
                    (ruleset, tf, z, sym, p, d, loc, t, res, json.dumps(det))
                    for z, sym, p, d, loc, t, res, det in cases
                ],
            )

    def stats(
        self, ruleset: str, tf: Timeframe, zone_tf: Timeframe, symbol: str = "*"
    ) -> list[tuple[str, str, str, dict[str, Any]]]:
        rows = (
            self._conn()
            .execute(
                "SELECT pattern, direction, location, summary FROM setup_stats "
                "WHERE ruleset=? AND tf=? AND zone_tf=? AND symbol=?",
                (ruleset, tf, zone_tf, symbol),
            )
            .fetchall()
        )
        return [(r[0], r[1], r[2], json.loads(r[3])) for r in rows]

    def setup_by_symbol(
        self,
        ruleset: str,
        tf: Timeframe,
        zone_tf: Timeframe,
        pattern: str,
        direction: str,
        location: str,
    ) -> list[tuple[str, dict[str, Any]]]:
        rows = (
            self._conn()
            .execute(
                "SELECT symbol, summary FROM setup_stats WHERE ruleset=? AND tf=? AND zone_tf=? "
                "AND pattern=? AND direction=? AND location=? AND symbol != '*'",
                (ruleset, tf, zone_tf, pattern, direction, location),
            )
            .fetchall()
        )
        return [(r[0], json.loads(r[1])) for r in rows]

    def cases(
        self,
        ruleset: str,
        tf: Timeframe,
        zone_tf: Timeframe,
        pattern: str,
        direction: str,
        location: str,
        symbol: str | None = None,
        limit: int = 20,
    ) -> list[dict[str, Any]]:
        sql = (
            "SELECT symbol, location, time, result, detail FROM setup_cases WHERE ruleset=? AND tf=? "
            "AND zone_tf=? AND pattern=? AND direction=? AND result IN ('win','loss')"
        )
        args: list[Any] = [ruleset, tf, zone_tf, pattern, direction]
        if location != "*":
            sql += " AND location=?"
            args.append(location)
        if symbol:
            sql += " AND symbol=?"
            args.append(symbol)
        sql += " ORDER BY time DESC LIMIT ?"
        args.append(limit)
        return [
            {"symbol": r[0], "location": r[1], "time": r[2], "result": r[3], **json.loads(r[4])}
            for r in self._conn().execute(sql, args).fetchall()
        ]
