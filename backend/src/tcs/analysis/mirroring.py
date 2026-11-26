"""Map hits found on a mirrored series back to the original (bearish) prices."""

from __future__ import annotations

from tcs.analysis.types import Line, PatternHit, Point

#: Labels name a bullish pattern's parts; upside down, lows are highs and upper is lower.
#: Labels not listed (pole, head, shoulders, neckline) read the same both ways.
_FLIPPED = {
    "Bottom 1": "Top 1",
    "Bottom 2": "Top 2",
    "Bottom 3": "Top 3",
    "Peak": "Trough",
    "Top": "Bottom",
    "Flag low": "Flag high",
    "Flag high": "Flag low",
    "Upper": "Lower",
    "Cup low": "Cup high",
    "Swing low": "Swing high",
    "Handle low": "Handle high",
    "Lower": "Upper",
}


def flip_label(label: str) -> str:
    return _FLIPPED.get(label, label)


def _p(p: Point) -> Point:
    return Point(p.index, -p.price, flip_label(p.label))


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
        lines=tuple(Line(_p(ln.a), _p(ln.b), flip_label(ln.label)) for ln in hit.lines),
        formation=hit.formation,
    )
