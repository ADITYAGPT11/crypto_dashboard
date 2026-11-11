"""Timeframes used for analysis, their durations and candle-close arithmetic."""

from __future__ import annotations

from typing import Literal, get_args

Timeframe = Literal["15m", "1h", "4h", "1d"]
TIMEFRAMES: tuple[Timeframe, ...] = get_args(Timeframe)

TF_MS: dict[Timeframe, int] = {
    "15m": 15 * 60_000,
    "1h": 3_600_000,
    "4h": 4 * 3_600_000,
    "1d": 86_400_000,
}

_RANK: dict[Timeframe, int] = {tf: i for i, tf in enumerate(TIMEFRAMES)}


def parse_timeframe(value: str) -> Timeframe:
    for tf in TIMEFRAMES:
        if tf == value:
            return tf
    raise ValueError(f"unsupported timeframe {value!r}; use one of {', '.join(TIMEFRAMES)}")


def is_at_least(tf: Timeframe, other: Timeframe) -> bool:
    """True when ``tf`` is the same as or higher than ``other``."""
    return _RANK[tf] >= _RANK[other]


def last_closed_open(now_ms: int, tf: Timeframe) -> int:
    """Open time of the most recent candle that has fully closed at ``now_ms``."""
    ms = TF_MS[tf]
    return (now_ms // ms) * ms - ms


def next_close(time_ms: int, tf: Timeframe) -> int:
    """Close time of the candle forming at ``time_ms``."""
    ms = TF_MS[tf]
    return (time_ms // ms) * ms + ms
