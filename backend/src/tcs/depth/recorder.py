"""Record order-book depth in the background so the chart's heatmap has history after a reload.

Per symbol: Binance USDⓈ-M, OKX and Delta Exchange India perpetual books, each on its own socket
with its own reconnect loop (one failing never stops the others or another symbol), added up sampled every
``SAMPLE_S`` seconds into one-minute columns (``sampler.py``) that go to the store, which keeps
``depth_days`` days. Public endpoints only, no keys; a Binance snapshot (weight 20) is fetched
only on (re)connect or when the diff chain breaks, at most every ``RESYNC_MIN_S``.

Observation only: visible orders can be pulled or spoofed. Nothing here feeds a statistic.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any, Literal, Protocol

import httpx

from tcs.depth.books import (
    BinanceBookSync,
    LocalBook,
    OkxBookSync,
    far_book,
    parse_binance_diff,
    parse_delta_l2,
    parse_levels,
    parse_okx_book,
    parse_okx_full_book,
)
from tcs.depth.sampler import Column, MinuteSampler
from tcs.store.sqlite import Store

log = logging.getLogger(__name__)

SAMPLE_S = 2.0
RESYNC_MIN_S = 5.0
BACKOFF_S = (1.0, 2.0, 5.0, 15.0, 30.0, 60.0)
OKX_PING_S = 25.0
#: Symbols the chart may add on top of the configured ones (each costs two sockets).
MAX_SYMBOLS = 6

# Order-book streams moved to /public (Binance futures WebSocket split, March 2026).
BINANCE_WS = "wss://fstream.binance.com/public/stream?streams={sym}@depth@500ms"
BINANCE_DEPTH = "https://fapi.binance.com/fapi/v1/depth"
OKX_WS = "wss://ws.okx.com/ws/v5/public"
OKX_INSTRUMENTS = "https://www.okx.com/api/v5/public/instruments"
OKX_BOOKS_FULL = "https://www.okx.com/api/v5/market/books-full"
DELTA_WS = "wss://socket.india.delta.exchange"
DELTA_PRODUCTS = "https://api.india.delta.exchange/v2/products/{product}"
#: Delta sends a full snapshot every few seconds; none for this long means the feed stalled.
DELTA_STALE_S = 20.0
#: OKX's full book (5 000 levels a side) refreshes the far levels this often.
DEEP_S = 5.0

Exchange = Literal["BINANCE", "OKX", "DELTA"]
State = Literal["connecting", "live", "down"]


class Socket(Protocol):
    def __aiter__(self) -> AsyncIterator[str | bytes]: ...
    async def send(self, message: str) -> None: ...


Connect = Callable[[str], contextlib.AbstractAsyncContextManager[Socket]]
FetchJson = Callable[[str, dict[str, str]], Awaitable[Any]]


@dataclass(slots=True)
class Feed:
    state: State = "connecting"
    error: str | None = None
    levels: int = 0
    since: int | None = None

    def set(self, state: State, error: str | None = None) -> None:
        if state == "live" and self.state != "live":
            self.since = int(time.time() * 1000)
        self.state, self.error = state, error


@dataclass(slots=True)
class SymbolBooks:
    binance: BinanceBookSync = field(default_factory=BinanceBookSync)
    okx: OkxBookSync = field(default_factory=OkxBookSync)
    feeds: dict[Exchange, Feed] = field(
        default_factory=lambda: {"BINANCE": Feed(), "OKX": Feed(), "DELTA": Feed()}
    )
    #: Delta's latest full snapshot and when it arrived (monotonic seconds).
    delta: LocalBook = field(default_factory=LocalBook)
    delta_at: float = 0.0
    sampler: MinuteSampler = field(default_factory=MinuteSampler)
    #: OKX contract value (base units per contract), once known.
    okx_ct_val: float = 0.0
    #: OKX's full REST book, for the levels beyond the live 400.
    okx_deep: LocalBook | None = None


def _default_connect(url: str) -> contextlib.AbstractAsyncContextManager[Socket]:
    import websockets

    return websockets.connect(url, open_timeout=15, ping_interval=20, max_size=2**23)  # type: ignore[return-value]


class DepthRecorder:
    def __init__(
        self,
        store: Store,
        symbols: tuple[str, ...],
        *,
        retention_days: int = 7,
        connect: Connect | None = None,
        fetch_json: FetchJson | None = None,
        now: Callable[[], int] = lambda: int(time.time() * 1000),
        sample_s: float = SAMPLE_S,
        deep_s: float = DEEP_S,
    ) -> None:
        self.store = store
        self.configured = symbols
        self.retention_days = retention_days
        self._connect = connect or _default_connect
        self._fetch = fetch_json or self._http_json
        self._now = now
        self._sample_s = sample_s
        self._deep_s = deep_s
        self._client: httpx.AsyncClient | None = None
        self.books: dict[str, SymbolBooks] = {}
        self._tasks: list[asyncio.Task[None]] = []
        self._loop: asyncio.AbstractEventLoop | None = None

    # Lifecycle ---------------------------------------------------------------

    async def start(self) -> None:
        self._loop = asyncio.get_running_loop()
        for s in self.configured:
            self._spawn(s)

    async def stop(self) -> None:
        for t in self._tasks:
            t.cancel()
        for t in self._tasks:
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await t
        self._tasks.clear()
        for sym, b in self.books.items():
            col = b.sampler.flush()
            if col:
                self.store.put_depth(sym, col, self._cutoff())
        if self._client:
            await self._client.aclose()

    def ensure(self, symbol: str) -> bool:
        """Start recording ``symbol`` if there is room; True when it is (now) recorded."""
        if symbol in self.books:
            return True
        if self._loop is None or len(self.books) >= MAX_SYMBOLS:
            return False
        self._loop.call_soon_threadsafe(self._spawn, symbol)
        return True

    def recorded(self) -> list[str]:
        return list(self.books)

    def _spawn(self, symbol: str) -> None:
        if symbol in self.books:
            return
        b = self.books[symbol] = SymbolBooks()
        for coro in (
            self._binance(symbol, b),
            self._okx(symbol, b),
            self._okx_deep(symbol, b),
            self._delta(symbol, b),
            self._sample(symbol, b),
        ):
            self._tasks.append(asyncio.create_task(coro))

    def _cutoff(self) -> int:
        return self._now() - self.retention_days * 86_400_000

    # Sampling ----------------------------------------------------------------

    async def _sample(self, symbol: str, b: SymbolBooks) -> None:
        while True:
            await asyncio.sleep(self._sample_s)
            col = self.sample_once(symbol, b)
            if col is not None:
                await asyncio.to_thread(self.store.put_depth, symbol, col, self._cutoff())

    def sample_once(self, symbol: str, b: SymbolBooks) -> Column | None:
        books: list[LocalBook] = []
        if b.binance.ready and b.feeds["BINANCE"].state == "live":
            books.append(b.binance.book)
        okx_live = b.okx.ready and b.feeds["OKX"].state == "live"
        if okx_live:
            books.append(b.okx.book)
        if okx_live and b.okx_deep is not None:
            # Only OKX's own live levels are replaced by the live book; other exchanges add up.
            books.append(far_book(b.okx_deep, [b.okx.book]))
        delta = b.feeds["DELTA"]
        if delta.state == "live" and time.monotonic() - b.delta_at > DELTA_STALE_S:
            delta.set("connecting", "no snapshot for 20 s")
        if delta.state == "live":
            books.append(b.delta)
        b.feeds["BINANCE"].levels = len(b.binance.book.bids) + len(b.binance.book.asks)
        b.feeds["OKX"].levels = len(b.okx.book.bids) + len(b.okx.book.asks)
        b.feeds["DELTA"].levels = len(b.delta.bids) + len(b.delta.asks)
        return b.sampler.sample(books, self._now())

    # Feeds -------------------------------------------------------------------

    async def _http_json(self, url: str, params: dict[str, str]) -> Any:
        if self._client is None:
            self._client = httpx.AsyncClient(
                timeout=15, headers={"User-Agent": "greenmtm-research/0.1"}
            )
        res = await self._client.get(url, params=params)
        res.raise_for_status()
        return res.json()

    async def _reconnecting(
        self, feed: Feed, name: str, session: Callable[[], Awaitable[None]]
    ) -> None:
        attempt = 0
        while True:
            started = time.monotonic()
            try:
                await session()
                feed.set("connecting")
            except asyncio.CancelledError:
                raise
            except Exception as err:
                feed.set("down", (str(err).splitlines() or [type(err).__name__])[0])
                log.info("depth %s: %s", name, feed.error)
            if time.monotonic() - started > 60:
                attempt = 0  # it ran for a while: start backing off from scratch
            await asyncio.sleep(BACKOFF_S[min(attempt, len(BACKOFF_S) - 1)])
            attempt += 1

    async def _binance(self, symbol: str, b: SymbolBooks) -> None:
        sym = symbol.replace("-", "")
        feed, sync = b.feeds["BINANCE"], b.binance
        last_snapshot = 0.0

        async def resnapshot() -> None:
            nonlocal last_snapshot
            wait = last_snapshot + RESYNC_MIN_S - time.monotonic()
            if wait > 0:
                await asyncio.sleep(wait)
            last_snapshot = time.monotonic()
            sync.reset()
            body = await self._fetch(BINANCE_DEPTH, {"symbol": sym, "limit": "1000"})
            r = sync.snapshot(
                int(body["lastUpdateId"]),
                parse_levels(body.get("bids")),
                parse_levels(body.get("asks")),
            )
            if r == "resync":
                raise _Resync
            feed.set("live")

        async def session() -> None:
            async with self._connect(BINANCE_WS.format(sym=sym.lower())) as ws:
                sync.reset()
                pending: asyncio.Task[None] | None = asyncio.create_task(resnapshot())
                try:
                    async for raw in ws:
                        if pending is not None and pending.done():
                            err = pending.exception()
                            pending = None
                            if isinstance(err, _Resync):
                                pending = asyncio.create_task(resnapshot())
                            elif err is not None:
                                raise err
                        d = parse_binance_diff(_json(raw))
                        if d and sync.diff(d) == "resync" and pending is None:
                            pending = asyncio.create_task(resnapshot())
                finally:
                    if pending is not None:
                        pending.cancel()

        await self._reconnecting(feed, f"{symbol} BINANCE", session)

    async def _okx_deep(self, symbol: str, b: SymbolBooks) -> None:
        inst = f"{symbol}-SWAP"
        while True:
            await asyncio.sleep(self._deep_s)
            if not b.okx_ct_val > 0:
                continue
            try:
                body = await self._fetch(OKX_BOOKS_FULL, {"instId": inst, "sz": "5000"})
                b.okx_deep = parse_okx_full_book(body, b.okx_ct_val) or b.okx_deep
            except asyncio.CancelledError:
                raise
            except Exception as err:
                log.debug("depth %s OKX full book: %s", symbol, err)

    async def _delta(self, symbol: str, b: SymbolBooks) -> None:
        product = f"{symbol.split('-')[0]}USD"  # Delta India perpetuals are USD-quoted
        feed = b.feeds["DELTA"]
        contract_value = 0.0

        async def session() -> None:
            nonlocal contract_value
            if not contract_value > 0:
                body = await self._fetch(DELTA_PRODUCTS.format(product=product), {})
                contract_value = float((body.get("result") or {}).get("contract_value") or 0)
                if not contract_value > 0:
                    raise RuntimeError(f"{product} not listed on Delta")
            async with self._connect(DELTA_WS) as ws:
                channels = [{"name": "l2_orderbook", "symbols": [product]}]
                await ws.send(json.dumps({"type": "subscribe", "payload": {"channels": channels}}))
                async for raw in ws:
                    book = parse_delta_l2(_json(raw), contract_value)
                    if book is None:
                        continue
                    b.delta, b.delta_at = book, time.monotonic()
                    if feed.state != "live":
                        feed.set("live")

        await self._reconnecting(feed, f"{symbol} DELTA", session)

    async def _okx(self, symbol: str, b: SymbolBooks) -> None:
        inst = f"{symbol}-SWAP"
        feed, sync = b.feeds["OKX"], b.okx
        ct_val = 0.0

        async def session() -> None:
            nonlocal ct_val
            if not ct_val > 0:
                body = await self._fetch(OKX_INSTRUMENTS, {"instType": "SWAP", "instId": inst})
                data = body.get("data") or [{}]
                ct_val = float(data[0].get("ctVal") or 0)
                if not ct_val > 0:
                    raise RuntimeError(f"{inst} not listed on OKX")
                b.okx_ct_val = ct_val
            async with self._connect(OKX_WS) as ws:
                sync.reset()

                async def sub(op: str) -> None:
                    await ws.send(
                        json.dumps({"op": op, "args": [{"channel": "books", "instId": inst}]})
                    )

                async def ping() -> None:
                    while True:
                        await asyncio.sleep(OKX_PING_S)
                        await ws.send("ping")

                await sub("subscribe")
                pinger = asyncio.create_task(ping())
                try:
                    async for raw in ws:
                        if raw in ("pong", b"pong"):
                            continue
                        msg = parse_okx_book(_json(raw), ct_val)
                        if msg is None:
                            continue
                        r = sync.handle(msg)
                        if r == "resync":
                            sync.reset()
                            await sub("unsubscribe")
                            await sub("subscribe")
                        elif r == "applied" and feed.state != "live":
                            feed.set("live")
                finally:
                    pinger.cancel()

        await self._reconnecting(feed, f"{symbol} OKX", session)


class _Resync(Exception):
    """The snapshot did not line up with the buffered stream: take another one."""


def _json(raw: str | bytes) -> Any:
    try:
        return json.loads(raw)
    except ValueError:
        return None
