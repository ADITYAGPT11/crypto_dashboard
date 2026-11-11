"""Settings from environment variables (no secrets here: market data is public)."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from tcs.common.universe import RESEARCH_UNIVERSE, is_canonical


def _universe() -> tuple[str, ...]:
    raw = os.environ.get("TCS_UNIVERSE", "")
    picked = tuple(s.strip().upper() for s in raw.split(",") if s.strip())
    return tuple(s for s in picked if is_canonical(s)) or RESEARCH_UNIVERSE


@dataclass(frozen=True, slots=True)
class Settings:
    db_path: Path = field(
        default_factory=lambda: Path(os.environ.get("TCS_DB", "data/tcs.sqlite3"))
    )
    #: Days of history the statistics job measures (one to two years).
    stats_days: int = field(default_factory=lambda: int(os.environ.get("TCS_STATS_DAYS", "730")))
    universe: tuple[str, ...] = field(default_factory=_universe)
    #: Run the background statistics job on a schedule inside the API process.
    schedule: bool = field(default_factory=lambda: os.environ.get("TCS_STATS_SCHEDULE", "1") != "0")
    host: str = field(default_factory=lambda: os.environ.get("TCS_HOST", "127.0.0.1"))
    port: int = field(default_factory=lambda: int(os.environ.get("TCS_PORT", "8000")))
