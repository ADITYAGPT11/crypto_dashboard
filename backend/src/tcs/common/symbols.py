"""Canonical symbols (`BASE-QUOTE`) and candle intervals shared by every module."""

from __future__ import annotations

import re

# Same list as the frontend's RESEARCH_UNIVERSE (src/services/HistoryService.ts): every pattern is
# pooled across these liquid Binance USDⓈ-M perpetuals, plus the symbol being viewed.
RESEARCH_UNIVERSE: tuple[str, ...] = (
    "BTC-USDT",
    "ETH-USDT",
    "SOL-USDT",
    "XRP-USDT",
    "BNB-USDT",
    "DOGE-USDT",
    "ADA-USDT",
    "AVAX-USDT",
    "LINK-USDT",
    "LTC-USDT",
)

# Every Binance USDⓈ-M kline interval except monthly (variable length), in milliseconds.
INTERVAL_MS: dict[str, int] = {
    "1m": 60_000,
    "3m": 180_000,
    "5m": 300_000,
    "15m": 900_000,
    "30m": 1_800_000,
    "1h": 3_600_000,
    "2h": 7_200_000,
    "4h": 14_400_000,
    "6h": 21_600_000,
    "8h": 28_800_000,
    "12h": 43_200_000,
    "1d": 86_400_000,
    "3d": 259_200_000,
    "1w": 604_800_000,
}

# Weekly candles open on Monday 00:00 UTC; the Unix epoch was a Thursday.
_WEEK_OFFSET_MS = 4 * 86_400_000

_SYMBOL_RE = re.compile(r"^[A-Z0-9]{1,20}-[A-Z0-9]{2,10}$")


def normalize_symbol(symbol: str) -> str:
    """Upper-case a canonical symbol and validate it; raises ValueError if malformed."""
    s = symbol.strip().upper()
    if not _SYMBOL_RE.match(s):
        raise ValueError(f"symbol must look like BTC-USDT, got {symbol!r}")
    return s


def to_binance(symbol: str) -> str:
    """`BTC-USDT` -> `BTCUSDT` (adapter boundary only)."""
    return normalize_symbol(symbol).replace("-", "")


def validate_interval(interval: str) -> str:
    if interval not in INTERVAL_MS:
        raise ValueError(f"unsupported interval {interval!r}; use one of {', '.join(INTERVAL_MS)}")
    return interval


def next_close(time_ms: int, interval: str) -> int:
    """Close time of the candle that was forming at `time_ms` (the next close after it)."""
    ms = INTERVAL_MS[interval]
    off = _WEEK_OFFSET_MS if interval == "1w" else 0
    return ((time_ms - off) // ms) * ms + ms + off
