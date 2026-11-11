"""Detect patterns on a coin's history and measure how each one performed before.

Scans are CPU-bound (~0.4 s for 3,000 candles x 190 chart detectors), so they run in a
worker thread and are cached until the coin's next candle closes (the history object
changes then). Outcomes are cheap and cached per bracket setting.
"""

from __future__ import annotations

import asyncio
import math
from collections import OrderedDict
from dataclasses import dataclass

import numpy as np
import numpy.typing as npt

from tcs.common.symbols import RESEARCH_UNIVERSE
from tcs.marketdata.binance_history import HistorySource
from tcs.marketdata.candles import Candles
from tcs.research.patterns.catalog import Kind
from tcs.research.patterns.detect import Event, events, scan
from tcs.research.patterns.outcome import BracketParams, Outcome, atr, evaluate
from tcs.research.patterns.stats import PatternStats, summarize

_CACHE_SIZE = 64


@dataclass(frozen=True)
class Occurrence:
    symbol: str
    event: Event
    open_time: int
    outcome: Outcome


@dataclass(frozen=True)
class Analysis:
    candles: Candles
    atr: npt.NDArray[np.float64]
    events: tuple[Event, ...]


@dataclass(frozen=True)
class PooledResult:
    symbols: tuple[str, ...]
    unavailable: tuple[str, ...]
    # (pattern, direction) -> outcomes across every symbol, and on the viewed symbol only
    pooled: dict[tuple[str, int], list[Occurrence]]
    own: dict[tuple[str, int], list[Occurrence]]


def analyze(candles: Candles, kinds: tuple[Kind, ...]) -> Analysis:
    a = atr(candles)
    evs = tuple(e for e in events(scan(candles, kinds)) if not math.isnan(a[e.index]))
    return Analysis(candles, a, evs)


def occurrences(analysis: Analysis, params: BracketParams) -> list[Occurrence]:
    c = analysis.candles
    return [
        Occurrence(
            c.symbol,
            e,
            int(c.open_time[e.index]),
            evaluate(c, e.index, e.direction, float(analysis.atr[e.index]), params),
        )
        for e in analysis.events
    ]


class _Lru[K, V]:
    def __init__(self, size: int) -> None:
        self._size = size
        self._d: OrderedDict[K, V] = OrderedDict()

    def get(self, key: K) -> V | None:
        if key in self._d:
            self._d.move_to_end(key)
            return self._d[key]
        return None

    def put(self, key: K, value: V) -> None:
        self._d[key] = value
        self._d.move_to_end(key)
        while len(self._d) > self._size:
            self._d.popitem(last=False)


class PatternResearch:
    def __init__(
        self, history: HistorySource, universe: tuple[str, ...] = RESEARCH_UNIVERSE
    ) -> None:
        self._history = history
        self._universe = universe
        self._analyses: _Lru[tuple[object, ...], Analysis] = _Lru(_CACHE_SIZE)
        self._occ: _Lru[tuple[object, ...], list[Occurrence]] = _Lru(_CACHE_SIZE * 4)
        self._locks: dict[tuple[object, ...], asyncio.Lock] = {}

    async def analysis(self, symbol: str, interval: str, kinds: tuple[Kind, ...]) -> Analysis:
        candles = await self._history.load(symbol, interval)
        last = int(candles.open_time[-1]) if len(candles) else -1
        key: tuple[object, ...] = (symbol, interval, len(candles), last, kinds)
        hit = self._analyses.get(key)
        if hit is not None:
            return hit
        lock = self._locks.setdefault(key, asyncio.Lock())
        async with lock:
            hit = self._analyses.get(key)
            if hit is None:
                hit = await asyncio.to_thread(analyze, candles, kinds)
                self._analyses.put(key, hit)
        self._locks.pop(key, None)
        return hit

    async def occurrences(
        self, symbol: str, interval: str, kinds: tuple[Kind, ...], params: BracketParams
    ) -> tuple[Analysis, list[Occurrence]]:
        a = await self.analysis(symbol, interval, kinds)
        c = a.candles
        last = int(c.open_time[-1]) if len(c) else -1
        key: tuple[object, ...] = (symbol, interval, len(c), last, kinds, params)
        occ = self._occ.get(key)
        if occ is None:
            occ = occurrences(a, params)
            self._occ.put(key, occ)
        return a, occ

    async def pooled(
        self, symbol: str, interval: str, kinds: tuple[Kind, ...], params: BracketParams
    ) -> PooledResult:
        """Outcomes on the viewed coin and pooled across it + the research universe.

        The viewed coin must load; any other coin that fails is listed as unavailable.
        """
        symbols = (symbol, *[s for s in self._universe if s != symbol])
        results = await asyncio.gather(
            *(self.occurrences(s, interval, kinds, params) for s in symbols),
            return_exceptions=True,
        )
        first = results[0]
        if isinstance(first, BaseException):
            raise first
        pooled: dict[tuple[str, int], list[Occurrence]] = {}
        own: dict[tuple[str, int], list[Occurrence]] = {}
        used: list[str] = []
        unavailable: list[str] = []
        for s, res in zip(symbols, results, strict=True):
            if isinstance(res, BaseException):
                unavailable.append(s)
                continue
            used.append(s)
            for o in res[1]:
                k = (o.event.pattern, o.event.direction)
                pooled.setdefault(k, []).append(o)
                if s == symbol:
                    own.setdefault(k, []).append(o)
        return PooledResult(tuple(used), tuple(unavailable), pooled, own)


def stats_of(occ: list[Occurrence], tests: int = 1) -> PatternStats:
    return summarize([o.outcome for o in occ], tests)
