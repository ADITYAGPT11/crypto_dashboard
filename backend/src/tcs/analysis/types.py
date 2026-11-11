"""Plain result types shared by every detector."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

Direction = Literal["long", "short"]
ZoneKind = Literal["demand", "supply"]
Location = Literal["confluence", "zone", "orderBlock", "openSpace"]
"""Where a setup formed, relative to its direction.

- ``zone``: at an intact demand zone (long) or supply zone (short);
- ``orderBlock``: at an intact bullish (long) or bearish (short) order block;
- ``confluence``: both at once;
- ``openSpace``: neither.
"""
LOCATIONS: tuple[Location, ...] = ("confluence", "zone", "orderBlock", "openSpace")


@dataclass(frozen=True, slots=True)
class Point:
    index: int
    price: float
    label: str = ""


@dataclass(frozen=True, slots=True)
class Line:
    a: Point
    b: Point
    label: str = ""


@dataclass(frozen=True, slots=True)
class PatternHit:
    """A pattern confirmed on candle ``index`` using only candles up to ``index``."""

    pattern: str
    direction: Direction
    index: int
    entry: float
    stop: float
    target: float
    #: First candle of the formation (locations must exist before it).
    start: int
    #: Pattern low for longs, pattern high for shorts (placed against zones).
    extreme: float
    points: tuple[Point, ...] = ()
    lines: tuple[Line, ...] = ()


@dataclass(frozen=True, slots=True)
class Zone:
    """A demand or supply zone: a base of small candles before a strong departure."""

    kind: ZoneKind
    low: float
    high: float
    #: First base candle.
    start: int
    #: Last departure candle: the zone is known once it closes.
    formed: int
    #: Candle that closed through the far (distal) edge, or None while intact.
    end: int | None
    tests: int
    held: int
    #: Size of the departure in ATR (how strongly price left the base).
    departure_atr: float


@dataclass(frozen=True, slots=True)
class OrderBlock:
    """The last opposite candle before a displacement that broke market structure."""

    kind: Literal["bullish", "bearish"]
    low: float
    high: float
    #: The order-block candle.
    index: int
    #: Candle whose close broke structure: the block is known once it closes.
    formed: int
    #: Candle that closed through the block (invalidated), or None.
    end: int | None
    #: First candle that traded back into the block after it formed, or None.
    mitigated: int | None
    #: Swing level that was broken.
    broke: float


@dataclass(frozen=True, slots=True)
class FairValueGap:
    """Three-candle imbalance: candle 1 and candle 3 wicks do not overlap."""

    kind: Literal["bullish", "bearish"]
    low: float
    high: float
    #: Middle (displacement) candle.
    index: int
    #: Third candle: the gap is known once it closes.
    formed: int
    #: Candle that traded through the whole gap, or None while (partly) open.
    filled: int | None


@dataclass(frozen=True, slots=True)
class StructureBreak:
    """A close beyond the last swing: BOS continues the trend, CHoCH reverses it."""

    kind: Literal["bos", "choch"]
    direction: Literal["up", "down"]
    level: float
    swing_index: int
    index: int


@dataclass(slots=True)
class Levels:
    zones: list[Zone] = field(default_factory=list[Zone])
    order_blocks: list[OrderBlock] = field(default_factory=list[OrderBlock])
    fvgs: list[FairValueGap] = field(default_factory=list[FairValueGap])
    structure: list[StructureBreak] = field(default_factory=list[StructureBreak])
