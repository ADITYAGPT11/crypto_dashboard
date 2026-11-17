"""Record order-book depth in the background so the chart's heatmap has history after a reload.

Per symbol: a Binance USDⓈ-M and an OKX perpetual book, each on its own socket with its own
reconnect loop (one failing never stops the other or another symbol), sampled every
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
    OkxBookSync,
    parse_binance_diff,
    parse_levels,
    parse_okx_book,
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

BINANCE_WS = "wss://fstream.binance.com/stream?streams={sym}@depth@500ms"
BINANCE_DEPTH = "https://fapi.binance.com/fapi/v1/depth"
OKX_WS = "wss://ws.okx.com:8443/ws/v5/public"
OKX_INSTRUMENTS = "https://www.okx.com/api/v5/public/instruments"

Exchange = Literal["BINANCE", "OKX"]
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
    feeds: dict[Exchange, Feed] = field(default_factory=lambda: {"BINANCE": Feed(), "OKX": Feed()})
    sampler: MinuteSampler = field(default_factory=MinuteSampler)


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
    ) -> None:
        self.store = store
        self.configured = symbols
        self.retention_days = retention_days
        self._connect = connect or _default_connect
        self._fetch = fetch_json or self._http_json
        self._now = now
        self._sample_s = sample_s
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
        for coro in (self._binance(symbol, b), self._okx(symbol, b), self._sample(symbol, b)):
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
        books = []
        if b.binance.ready and b.feeds["BINANCE"].state == "live":
            books.append(b.binance.book)
        if b.okx.ready and b.feeds["OKX"].state == "live":
            books.append(b.okx.book)
        b.feeds["BINANCE"].levels = len(b.binance.book.bids) + len(b.binance.book.asks)
        b.feeds["OKX"].levels = len(b.okx.book.bids) + len(b.okx.book.asks)
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
