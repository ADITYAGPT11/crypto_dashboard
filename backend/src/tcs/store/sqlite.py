"""SQLite storage: candles and setup statistics.

Interim store until the QuestDB collector lands (DECISIONS 2026-11-11): zero setup,
one file, WAL mode so the API reads while the statistics job writes.
"""

from __future__ import annotations

import json
import math
import sqlite3
import threading
from collections.abc import Generator, Iterable, Sequence
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

CREATE TABLE IF NOT EXISTS stats_runs (
  ruleset TEXT NOT NULL, tf TEXT NOT NULL,
  status TEXT NOT NULL, started_at INTEGER NOT NULL, finished_at INTEGER,
  meta TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (ruleset, tf)
);

CREATE TABLE IF NOT EXISTS setup_stats (
  ruleset TEXT NOT NULL, tf TEXT NOT NULL, zone_tf TEXT NOT NULL, symbol TEXT NOT NULL,
  pattern TEXT NOT NULL, direction TEXT NOT NULL, location TEXT NOT NULL,
  context TEXT NOT NULL DEFAULT '*',
  summary TEXT NOT NULL,
  PRIMARY KEY (ruleset, tf, zone_tf, symbol, pattern, direction, location, context)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS setup_cases (
  ruleset TEXT NOT NULL, tf TEXT NOT NULL, zone_tf TEXT NOT NULL, symbol TEXT NOT NULL,
  pattern TEXT NOT NULL, direction TEXT NOT NULL, location TEXT NOT NULL,
  time INTEGER NOT NULL, result TEXT NOT NULL, detail TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS depth_columns (
  symbol TEXT NOT NULL, time INTEGER NOT NULL,
  bucket REAL NOT NULL, mid REAL NOT NULL, samples INTEGER NOT NULL,
  bids TEXT NOT NULL, asks TEXT NOT NULL,
  PRIMARY KEY (symbol, time)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS setup_cases_key
  ON setup_cases (ruleset, tf, zone_tf, pattern, direction, location, time);

CREATE TABLE IF NOT EXISTS playbook_stats (
  ruleset TEXT NOT NULL, pair TEXT NOT NULL, symbol TEXT NOT NULL,
  entry TEXT NOT NULL, exit TEXT NOT NULL, segment TEXT NOT NULL,
  summary TEXT NOT NULL,
  PRIMARY KEY (ruleset, pair, symbol, entry, exit, segment)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS playbook_trades (
  ruleset TEXT NOT NULL, pair TEXT NOT NULL, symbol TEXT NOT NULL,
  entry TEXT NOT NULL, exit TEXT NOT NULL, time INTEGER NOT NULL, detail TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS forward_meta (
  ruleset TEXT NOT NULL, pair TEXT NOT NULL,
  started_at INTEGER NOT NULL, last_run INTEGER, meta TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (ruleset, pair)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS forward_trades (
  ruleset TEXT NOT NULL, pair TEXT NOT NULL, entry TEXT NOT NULL, exit TEXT NOT NULL,
  symbol TEXT NOT NULL, trigger_time INTEGER NOT NULL, pattern TEXT NOT NULL,
  direction TEXT NOT NULL,
  status TEXT NOT NULL, first_seen INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  detail TEXT NOT NULL,
  PRIMARY KEY (ruleset, pair, entry, exit, symbol, trigger_time, pattern, direction)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS playbook_trades_key
  ON playbook_trades (ruleset, pair, entry, exit, time);
"""


def _migrate(db: sqlite3.Connection) -> None:
    """Stores made before taker volume was kept: add the column and drop the cached candles.

    Candles are a cache of Binance's public archive, so they are downloaded again (with taker
    volume) the next time a chart or the statistics job asks for them.
    """
    cols = {row[1] for row in db.execute("PRAGMA table_info(candles)")}
    if "taker_buy" not in cols:
        db.execute("ALTER TABLE candles ADD COLUMN taker_buy REAL")
        db.execute("DELETE FROM candles")
    # Statistics split by order-flow context (ruleset 2026.11-r2): older rows belong to an
    # older rule set and are recomputed anyway, so the table is rebuilt with the new key.
    stat_cols = {row[1] for row in db.execute("PRAGMA table_info(setup_stats)")}
    if "context" not in stat_cols:
        db.execute("DROP TABLE setup_stats")
        db.executescript(SCHEMA)


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

    # Statistics --------------------------------------------------------------

    def start_run(self, ruleset: str, tf: str, now: int, meta: dict[str, Any]) -> None:
        with self.tx() as db:
            db.execute(
                "INSERT OR REPLACE INTO stats_runs VALUES (?,?,?,?,?,?)",
                (ruleset, tf, "running", now, None, json.dumps(meta)),
            )

    def update_run(self, ruleset: str, tf: str, meta: dict[str, Any]) -> None:
        with self.tx() as db:
            db.execute(
                "UPDATE stats_runs SET meta=? WHERE ruleset=? AND tf=?",
                (json.dumps(meta), ruleset, tf),
            )

    def finish_run(
        self, ruleset: str, tf: str, now: int, status: str, meta: dict[str, Any]
    ) -> None:
        with self.tx() as db:
            db.execute(
                "UPDATE stats_runs SET status=?, finished_at=?, meta=? WHERE ruleset=? AND tf=?",
                (status, now, json.dumps(meta), ruleset, tf),
            )

    def run(self, ruleset: str, tf: str) -> dict[str, Any] | None:
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
        stats: Sequence[tuple[str, str, str, str, str, str, dict[str, Any]]],
        cases: Sequence[tuple[str, str, str, str, str, int, str, dict[str, Any]]],
    ) -> None:
        """Swap in a finished run's results atomically (readers never see half a run)."""
        with self.tx() as db:
            db.execute("DELETE FROM setup_stats WHERE ruleset=? AND tf=?", (ruleset, tf))
            db.execute("DELETE FROM setup_cases WHERE ruleset=? AND tf=?", (ruleset, tf))
            db.executemany(
                "INSERT INTO setup_stats VALUES (?,?,?,?,?,?,?,?,?)",
                [
                    (ruleset, tf, z, sym, p, d, loc, ctx, json.dumps(s))
                    for z, sym, p, d, loc, ctx, s in stats
                ],
            )
            db.executemany(
                "INSERT INTO setup_cases VALUES (?,?,?,?,?,?,?,?,?,?)",
                [
                    (ruleset, tf, z, sym, p, d, loc, t, res, json.dumps(det))
                    for z, sym, p, d, loc, t, res, det in cases
                ],
            )

    def stats(
        self,
        ruleset: str,
        tf: Timeframe,
        zone_tf: Timeframe,
        symbol: str = "*",
        context: str = "*",
    ) -> list[tuple[str, str, str, dict[str, Any]]]:
        rows = (
            self._conn()
            .execute(
                "SELECT pattern, direction, location, summary FROM setup_stats "
                "WHERE ruleset=? AND tf=? AND zone_tf=? AND symbol=? AND context=?",
                (ruleset, tf, zone_tf, symbol, context),
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
                "AND pattern=? AND direction=? AND location=? AND symbol != '*' AND context='*'",
                (ruleset, tf, zone_tf, pattern, direction, location),
            )
            .fetchall()
        )
        return [(r[0], json.loads(r[1])) for r in rows]

    def contexts(
        self,
        ruleset: str,
        tf: Timeframe,
        zone_tf: Timeframe,
        pattern: str,
        direction: str,
        location: str,
    ) -> list[tuple[str, dict[str, Any]]]:
        """Pooled record of one setup per order-flow context (``*`` excluded)."""
        rows = (
            self._conn()
            .execute(
                "SELECT context, summary FROM setup_stats WHERE ruleset=? AND tf=? AND zone_tf=? "
                "AND pattern=? AND direction=? AND location=? AND symbol='*' AND context != '*'",
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

    # Order-book depth (heatmap history) ---------------------------------------

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

    # Playbook (multi-timeframe) statistics ------------------------------------

    def replace_playbook(
        self,
        ruleset: str,
        pair: str,
        stats: Sequence[tuple[str, str, str, str, dict[str, Any]]],
        trades: Sequence[tuple[str, str, str, int, dict[str, Any]]],
    ) -> None:
        """Swap in a finished playbook run (stats: symbol, entry, exit, segment, summary;
        trades: symbol, entry, exit, time, detail)."""
        with self.tx() as db:
            db.execute("DELETE FROM playbook_stats WHERE ruleset=? AND pair=?", (ruleset, pair))
            db.execute("DELETE FROM playbook_trades WHERE ruleset=? AND pair=?", (ruleset, pair))
            db.executemany(
                "INSERT INTO playbook_stats VALUES (?,?,?,?,?,?,?)",
                [(ruleset, pair, *row[:4], json.dumps(row[4])) for row in stats],
            )
            db.executemany(
                "INSERT INTO playbook_trades VALUES (?,?,?,?,?,?,?)",
                [(ruleset, pair, *row[:4], json.dumps(row[4])) for row in trades],
            )

    def playbook_stats(
        self, ruleset: str, pair: str, symbol: str = "*"
    ) -> list[tuple[str, str, str, dict[str, Any]]]:
        """(entry, exit, segment, summary) rows."""
        rows = (
            self._conn()
            .execute(
                "SELECT entry, exit, segment, summary FROM playbook_stats "
                "WHERE ruleset=? AND pair=? AND symbol=?",
                (ruleset, pair, symbol),
            )
            .fetchall()
        )
        return [(r[0], r[1], r[2], json.loads(r[3])) for r in rows]

    def playbook_trades(
        self, ruleset: str, pair: str, entry: str, exit: str, limit: int = 20
    ) -> list[dict[str, Any]]:
        rows = (
            self._conn()
            .execute(
                "SELECT symbol, time, detail FROM playbook_trades WHERE ruleset=? AND pair=? "
                "AND entry=? AND exit=? ORDER BY time DESC LIMIT ?",
                (ruleset, pair, entry, exit, limit),
            )
            .fetchall()
        )
        return [{"symbol": r[0], "time": r[1], **json.loads(r[2])} for r in rows]

    def playbook_all_trades(
        self, ruleset: str, pair: str, entry: str, exit: str
    ) -> list[dict[str, Any]]:
        """Every closed trade of one variant, oldest first by fill time (paper account replay)."""
        rows = (
            self._conn()
            .execute(
                "SELECT symbol, time, detail FROM playbook_trades WHERE ruleset=? AND pair=? "
                "AND entry=? AND exit=?",
                (ruleset, pair, entry, exit),
            )
            .fetchall()
        )
        out = [{"symbol": r[0], "time": r[1], **json.loads(r[2])} for r in rows]
        out.sort(key=lambda t: (t.get("fillTime") or t["time"], t["symbol"]))
        return out

    # Forward paper trading ------------------------------------------------------

    def forward_start(self, ruleset: str, pair: str, now: int) -> int:
        """When forward tracking of this rule set began (set on first call)."""
        with self.tx() as db:
            db.execute(
                "INSERT OR IGNORE INTO forward_meta (ruleset, pair, started_at) VALUES (?,?,?)",
                (ruleset, pair, now),
            )
            row = db.execute(
                "SELECT started_at FROM forward_meta WHERE ruleset=? AND pair=?", (ruleset, pair)
            ).fetchone()
        return int(row[0])

    def forward_meta(self, ruleset: str, pair: str) -> dict[str, Any] | None:
        row = (
            self._conn()
            .execute(
                "SELECT started_at, last_run, meta FROM forward_meta WHERE ruleset=? AND pair=?",
                (ruleset, pair),
            )
            .fetchone()
        )
        if row is None:
            return None
        return {"started_at": row[0], "last_run": row[1], "meta": json.loads(row[2])}

    def forward_ran(self, ruleset: str, pair: str, now: int, meta: dict[str, Any]) -> None:
        with self.tx() as db:
            db.execute(
                "UPDATE forward_meta SET last_run=?, meta=? WHERE ruleset=? AND pair=?",
                (now, json.dumps(meta), ruleset, pair),
            )

    def upsert_forward(
        self,
        ruleset: str,
        pair: str,
        rows: Sequence[tuple[str, str, str, int, str, str, str, int, dict[str, Any]]],
    ) -> int:
        """Record forward trades (entry, exit, symbol, trigger time, pattern, direction, status,
        now, detail). A closed trade is frozen: later runs never rewrite it. Returns rows changed."""
        changed = 0
        with self.tx() as db:
            for e, x, sym, t, pat, d, status, now, detail in rows:
                cur = db.execute(
                    "INSERT INTO forward_trades VALUES (?,?,?,?,?,?,?,?,?,?,?,?) "
                    "ON CONFLICT (ruleset, pair, entry, exit, symbol, trigger_time, pattern, "
                    "direction) DO UPDATE SET status=excluded.status, "
                    "updated_at=excluded.updated_at, detail=excluded.detail "
                    "WHERE forward_trades.status != 'closed'",
                    (ruleset, pair, e, x, sym, t, pat, d, status, now, now, json.dumps(detail)),
                )
                changed += cur.rowcount
        return changed

    def forward_trades(
        self, ruleset: str, pair: str, entry: str, exit: str
    ) -> list[dict[str, Any]]:
        rows = (
            self._conn()
            .execute(
                "SELECT symbol, trigger_time, pattern, direction, status, first_seen, updated_at, "
                "detail FROM forward_trades WHERE ruleset=? AND pair=? AND entry=? AND exit=? "
                "ORDER BY trigger_time",
                (ruleset, pair, entry, exit),
            )
            .fetchall()
        )
        return [
            {
                "symbol": r[0],
                "time": r[1],
                "pattern": r[2],
                "direction": r[3],
                "status": r[4],
                "firstSeen": r[5],
                "updatedAt": r[6],
                **json.loads(r[7]),
            }
            for r in rows
        ]
