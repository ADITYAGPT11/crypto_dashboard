"""Full-depth local order books kept in sync from exchange diff streams.

A port of ``src/utils/depthBook.ts`` (the browser's heatmap uses the same procedure):

- Binance USDⓈ-M: buffer ``depthUpdate`` events, fetch a REST snapshot, drop events with
  ``u < lastUpdateId``; the first applied event must straddle the snapshot
  (``U <= lastUpdateId <= u``) and every later event's ``pu`` must equal the previous ``u``;
  otherwise the book is rebuilt.
- OKX ``books``: a snapshot, then updates whose ``prevSeqId`` must equal the last ``seqId``;
  otherwise resubscribe.

Sizes are in BASE units (OKX contracts are multiplied by the contract value).
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Literal

Level = tuple[float, float]
SyncResult = Literal["applied", "skipped", "buffered", "resync"]


class LocalBook:
    def __init__(self) -> None:
        self.bids: dict[float, float] = {}
        self.asks: dict[float, float] = {}

    def clear(self) -> None:
        self.bids.clear()
        self.asks.clear()

    def apply(self, side: Literal["bid", "ask"], levels: list[Level]) -> None:
        m = self.bids if side == "bid" else self.asks
        for p, q in levels:
            if q <= 0:
                m.pop(p, None)
            else:
                m[p] = q

    def best_bid(self) -> float | None:
        return max(self.bids) if self.bids else None

    def best_ask(self) -> float | None:
        return min(self.asks) if self.asks else None

    def mid(self) -> float | None:
        b, a = self.best_bid(), self.best_ask()
        if b is not None and a is not None:
            return (a + b) / 2
        return b if b is not None else a

    def crossed(self) -> bool:
        b, a = self.best_bid(), self.best_ask()
        return b is not None and a is not None and b >= a


def _num(v: Any) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return math.nan


def parse_levels(raw: Any, multiplier: float = 1.0) -> list[Level]:
    if not isinstance(raw, list):
        return []
    out: list[Level] = []
    for r in raw:
        if not isinstance(r, list | tuple) or len(r) < 2:
            continue
        p, q = _num(r[0]), _num(r[1]) * multiplier
        if math.isfinite(p) and math.isfinite(q) and p > 0 and q >= 0:
            out.append((p, q))
    return out


@dataclass(frozen=True, slots=True)
class BinanceDiff:
    first: int  # U
    last: int  # u
    prev: int  # pu
    bids: list[Level]
    asks: list[Level]


def parse_binance_diff(msg: Any) -> BinanceDiff | None:
    m = msg.get("data", msg) if isinstance(msg, dict) else None
    if not isinstance(m, dict) or m.get("e") != "depthUpdate":
        return None
    try:
        first, last, prev = int(m["U"]), int(m["u"]), int(m["pu"])
    except (KeyError, TypeError, ValueError):
        return None
    return BinanceDiff(first, last, prev, parse_levels(m.get("b")), parse_levels(m.get("a")))


class BinanceBookSync:
    """Binance's snapshot + diff synchronisation. Feed every event; call ``snapshot`` once fetched."""

    def __init__(self) -> None:
        self.book = LocalBook()
        self._buffer: list[BinanceDiff] = []
        self._last: int | None = None
        self._snapshot_id: int | None = None

    @property
    def ready(self) -> bool:
        return self._last is not None

    def reset(self) -> None:
        self.book.clear()
        self._buffer = []
        self._last = None
        self._snapshot_id = None

    def snapshot(self, last_update_id: int, bids: list[Level], asks: list[Level]) -> SyncResult:
        self.book.clear()
        self.book.apply("bid", bids)
        self.book.apply("ask", asks)
        self._snapshot_id = last_update_id
        self._last = None
        pending, self._buffer = self._buffer, []
        result: SyncResult = "buffered"
        for e in pending:
            result = self.diff(e)
            if result == "resync":
                return result
        return result

    def diff(self, e: BinanceDiff) -> SyncResult:
        if self._snapshot_id is None:
            self._buffer.append(e)
            if len(self._buffer) > 2000:
                self._buffer.pop(0)
            return "buffered"
        if self._last is None:
            if e.last < self._snapshot_id:
                return "skipped"
            if e.first > self._snapshot_id:
                return "resync"  # missed events between the snapshot and the stream
        elif e.prev != self._last:
            return "resync"
        self.book.apply("bid", e.bids)
        self.book.apply("ask", e.asks)
        self._last = e.last
        return "resync" if self.book.crossed() else "applied"


@dataclass(frozen=True, slots=True)
class OkxBookMsg:
    action: Literal["snapshot", "update"]
    seq: int
    prev: int
    bids: list[Level]
    asks: list[Level]


def parse_okx_book(msg: Any, ct_val: float) -> OkxBookMsg | None:
    if not isinstance(msg, dict):
        return None
    action = msg.get("action")
    data = msg.get("data")
    if action not in ("snapshot", "update") or not isinstance(data, list) or not data:
        return None
    d = data[0]
    if not isinstance(d, dict):
        return None
    try:
        seq = int(d["seqId"])
        prev = int(d.get("prevSeqId", -1))
    except (KeyError, TypeError, ValueError):
        return None
    kind: Literal["snapshot", "update"] = "snapshot" if action == "snapshot" else "update"
    return OkxBookMsg(
        kind, seq, prev, parse_levels(d.get("bids"), ct_val), parse_levels(d.get("asks"), ct_val)
    )


class OkxBookSync:
    def __init__(self) -> None:
        self.book = LocalBook()
        self._seq: int | None = None

    @property
    def ready(self) -> bool:
        return self._seq is not None

    def reset(self) -> None:
        self.book.clear()
        self._seq = None

    def handle(self, m: OkxBookMsg) -> SyncResult:
        if m.action == "snapshot":
            self.book.clear()
            self.book.apply("bid", m.bids)
            self.book.apply("ask", m.asks)
            self._seq = m.seq
            return "applied"
        if self._seq is None:
            return "skipped"
        if m.prev != self._seq:
            return "resync"
        self.book.apply("bid", m.bids)
        self.book.apply("ask", m.asks)
        self._seq = m.seq
        return "resync" if self.book.crossed() else "applied"


def far_book(deep: LocalBook, near: list[LocalBook]) -> LocalBook:
    """Levels of a deep (REST) book beyond what the live books cover: bids below their lowest
    bid, asks above their highest ask (port of ``farBook`` in ``depthBook.ts``)."""
    min_bid = min((p for b in near for p in b.bids), default=math.inf)
    max_ask = max((p for b in near for p in b.asks), default=-math.inf)
    out = LocalBook()
    out.bids.update({p: q for p, q in deep.bids.items() if p < min_bid})
    out.asks.update({p: q for p, q in deep.asks.items() if p > max_ask})
    return out


def parse_okx_full_book(body: Any, ct_val: float) -> LocalBook | None:
    """OKX ``market/books-full`` (sizes in contracts) as a book in base units."""
    data = body.get("data") if isinstance(body, dict) else None
    if not isinstance(data, list) or not data or not isinstance(data[0], dict):
        return None
    book = LocalBook()
    book.apply("bid", parse_levels(data[0].get("bids"), ct_val))
    book.apply("ask", parse_levels(data[0].get("asks"), ct_val))
    return book if book.bids or book.asks else None
