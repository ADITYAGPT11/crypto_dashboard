"""Map hits found on a mirrored series back to the original (bearish) prices."""

from __future__ import annotations

from tcs.analysis.types import Line, PatternHit, Point


def _p(p: Point) -> Point:
    return Point(p.index, -p.price, p.label)


def unmirror(hit: PatternHit, pattern: str) -> PatternHit:
    return PatternHit(
        pattern=pattern,
        direction="short",
        index=hit.index,
        entry=-hit.entry,
        stop=-hit.stop,
        target=-hit.target,
        start=hit.start,
        extreme=-hit.extreme,
        points=tuple(_p(p) for p in hit.points),
        lines=tuple(Line(_p(ln.a), _p(ln.b), ln.label) for ln in hit.lines),
    )
