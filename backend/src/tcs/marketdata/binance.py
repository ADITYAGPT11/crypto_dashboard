"""Binance USDⓈ-M perpetual candles: public REST for recent data, the official public
archive (data.binance.vision) for bulk history. No API key; both are free.

Respect the limits: klines with limit=1500 weigh 10 of 2400/min; we pace REST calls
(``MIN_INTERVAL_S``) and stop calling REST for a while after it refuses us.
"""

from __future__ import annotations

import io
import threading
import time
import zipfile

import httpx

from tcs.common.series import Candle
from tcs.common.timeframes import TF_MS, Timeframe
from tcs.common.universe import to_exchange_symbol

REST = "https://fapi.binance.com/fapi/v1/klines"
ARCHIVE = "https://data.binance.vision/data/futures/um"
PAGE = 1500
MIN_INTERVAL_S = 0.25
REST_COOLDOWN_S = 300


class SourceUnavailable(Exception):
    """The source refused or could not be reached (network, geo-block, rate limit)."""


def _client() -> httpx.Client:
    return httpx.Client(
        timeout=20, headers={"User-Agent": "tcs-research/0.1"}, follow_redirects=True
    )


def _row(r: list[str | float | int]) -> Candle:
    return Candle(int(r[0]), float(r[1]), float(r[2]), float(r[3]), float(r[4]), float(r[5]))


class BinanceKlines:
    def __init__(self, client: httpx.Client | None = None) -> None:
        self.client = client or _client()
        self._lock = threading.Lock()
        self._last_call = 0.0
        self._rest_down_until = 0.0

    def _pace(self) -> None:
        with self._lock:
            wait = self._last_call + MIN_INTERVAL_S - time.monotonic()
            if wait > 0:
                time.sleep(wait)
            self._last_call = time.monotonic()

    @property
    def rest_available(self) -> bool:
        return time.monotonic() >= self._rest_down_until

    def rest(self, symbol: str, tf: Timeframe, start: int, end: int) -> list[Candle]:
        """Candles with open time in [start, end], paged forward."""
        if not self.rest_available:
            raise SourceUnavailable("Binance REST cooling down after a refusal")
        out: list[Candle] = []
        cursor = start
        while cursor <= end:
            self._pace()
            try:
                res = self.client.get(
                    REST,
                    params={
                        "symbol": to_exchange_symbol(symbol),
                        "interval": tf,
                        "startTime": cursor,
                        "endTime": end,
                        "limit": PAGE,
                    },
                )
            except httpx.HTTPError as err:
                self._rest_down_until = time.monotonic() + REST_COOLDOWN_S
                raise SourceUnavailable(f"Binance REST unreachable: {err}") from err
            if res.status_code in (403, 418, 429, 451):
                retry = float(res.headers.get("Retry-After", REST_COOLDOWN_S))
                self._rest_down_until = time.monotonic() + max(retry, 60)
                raise SourceUnavailable(f"Binance REST HTTP {res.status_code}")
            if res.status_code != 200:
                raise SourceUnavailable(f"Binance REST HTTP {res.status_code}")
            body = res.json()
            if not isinstance(body, list) or not body:
                break
            batch = [_row(r) for r in body]
            out.extend(batch)
            if len(batch) < PAGE:
                break
            cursor = batch[-1].open_time + TF_MS[tf]
        return out

    def _zip(self, url: str) -> list[Candle] | None:
        try:
            res = self.client.get(url)
        except httpx.HTTPError as err:
            raise SourceUnavailable(f"archive unreachable: {err}") from err
        if res.status_code == 404:
            return None  # not published (yet), or the coin was not listed then
        if res.status_code != 200:
            raise SourceUnavailable(f"archive HTTP {res.status_code}")
        with zipfile.ZipFile(io.BytesIO(res.content)) as z:
            text = z.read(z.namelist()[0]).decode()
        rows: list[Candle] = []
        for line in text.splitlines():
            if not line or not line[0].isdigit():
                continue  # header row (newer files have one)
            p = line.split(",")
            rows.append(
                Candle(int(p[0]), float(p[1]), float(p[2]), float(p[3]), float(p[4]), float(p[5]))
            )
        return rows

    def archive_month(
        self, symbol: str, tf: Timeframe, year: int, month: int
    ) -> list[Candle] | None:
        s = to_exchange_symbol(symbol)
        return self._zip(f"{ARCHIVE}/monthly/klines/{s}/{tf}/{s}-{tf}-{year:04d}-{month:02d}.zip")

    def archive_day(self, symbol: str, tf: Timeframe, day: str) -> list[Candle] | None:
        s = to_exchange_symbol(symbol)
        return self._zip(f"{ARCHIVE}/daily/klines/{s}/{tf}/{s}-{tf}-{day}.zip")
