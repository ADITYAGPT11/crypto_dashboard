"""Triangles, wedges, rectangles and channels: two trendlines through confirmed swings.

One detector, classified by the slopes of its lines (Edwards & Magee ch. 8-10; Bulkowski).
Converging lines (the end at least 25% narrower than the start):

==================  ===================  ===================  ===========
pattern             upper line           lower line           usual way
==================  ===================  ===================  ===========
ascending triangle  flat                 rising               up
symmetrical         falling              rising               either
falling wedge       falling (steeper)    falling              up
==================  ===================  ===================  ===========

Parallel lines (the width at the breakout within 25% of the start's, r13): a **rectangle**
when both are flat, a **rising / falling channel** when both slope the same way. All three
break either way.

The bearish twins (descending triangle, symmetrical down, rising wedge) are the
same rule on the mirrored series. A breakout against a pattern's usual direction
(an ascending triangle or falling wedge breaking down, a descending triangle or
rising wedge breaking up) is a signal in the breakout's direction, as Bulkowski
counts it (r12; until r11 it was a failed pattern with no signal).

Lines are fitted through the last 2-3 swing highs and 2-3 swing lows known at the
breakout candle, at least five swings in all (3 + 2 or 3 + 3: Bulkowski's minimum
touches); least squares, every swing within ``TOUCH_TOL_ATR`` of its line.
Closes must stay inside the lines during the formation; the lines must converge
and not have crossed, and the breakout must come at most three quarters of the way
from the start to the apex. Confirmed on the first close beyond the line.

Plan: entry = breakout close; stop = the last swing on the other side - 0.2 ATR;
target = triangles: breakout + height at the start (measured move); wedges: back
to where the wedge began (its highest high for a falling wedge).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from tcs.analysis.indicators import atr
from tcs.analysis.mirroring import unmirror
from tcs.analysis.swings import SWING_BARS, Swing, swing_highs, swing_lows
from tcs.analysis.types import Line, PatternHit, Point
from tcs.common.series import FloatArray, Series, mirror

MIN_BARS, MAX_BARS = 10, 100  # formation length, first swing to breakout
TOUCH_TOL_ATR = 0.4  # each swing within this distance of its fitted line
INSIDE_TOL_ATR = 0.25  # closes may poke this far outside a line during the formation
FLAT_ATR = 0.6  # a line moving less than this over the whole formation is flat
MIN_HEIGHT_ATR = 2.0  # height at the start
MIN_CONVERGENCE = 0.25  # the end must be at least 25% narrower than the start
MAX_APEX_SHARE = 0.75  # breakout at most this far from the start to the apex (r12)
PARALLEL_TOL = 0.25  # parallel: the width at the breakout within this share of the start's (r13)
STOP_PAD_ATR = 0.2


@dataclass(frozen=True, slots=True)
class _Fit:
    slope: float
    intercept: float
    worst: float  # largest distance of a swing from the line

    def at(self, x: float) -> float:
        return self.intercept + self.slope * x


def _fit(points: list[Swing]) -> _Fit:
    xs = np.array([p.index for p in points], dtype=np.float64)
    ys = np.array([p.price for p in points], dtype=np.float64)
    if len(points) == 2:
        slope = float((ys[1] - ys[0]) / (xs[1] - xs[0]))
        return _Fit(slope, float(ys[0] - slope * xs[0]), 0.0)
    # Ordinary least squares, closed form (np.polyfit is ~20x slower for 3 points).
    mx, my = float(xs.mean()), float(ys.mean())
    dx = xs - mx
    slope = float((dx * (ys - my)).sum() / (dx * dx).sum())
    intercept = my - slope * mx
    worst = float(np.max(np.abs(ys - (intercept + slope * xs))))
    return _Fit(slope, intercept, worst)


def _classify(rise_u: float, rise_l: float) -> str | None:
    """The pattern an upward breakout completes, from the line rises (ATR over the formation).

    Upward is the usual way out of an ascending triangle and a falling wedge; a descending
    triangle or a rising wedge breaking UP is the less common, against-the-bias breakout,
    which Bulkowski counts as the same pattern with an upward breakout (r12).
    """
    flat_u, flat_l = abs(rise_u) <= FLAT_ATR, abs(rise_l) <= FLAT_ATR
    if flat_u and rise_l > FLAT_ATR:
        return "ascendingTriangle"
    if flat_l and rise_u < -FLAT_ATR:
        return "descendingTriangle"  # against its bias
    if rise_u < -FLAT_ATR and rise_l > FLAT_ATR:
        return "symmetricalTriangle"
    if rise_u < -FLAT_ATR and rise_l < -FLAT_ATR and rise_u < rise_l:
        return "fallingWedge"
    if rise_u > FLAT_ATR and rise_l > FLAT_ATR and rise_l > rise_u:
        return "risingWedge"  # against its bias
    return None


def _classify_parallel(rise_u: float, rise_l: float) -> str | None:
    """Parallel lines (r13): a rectangle when both are flat, else a channel sloping their way."""
    if abs(rise_u) <= FLAT_ATR and abs(rise_l) <= FLAT_ATR:
        return "rectangle"
    if rise_u > FLAT_ATR and rise_l > FLAT_ATR:
        return "risingChannel"
    if rise_u < -FLAT_ATR and rise_l < -FLAT_ATR:
        return "fallingChannel"
    return None


def _upward(s: Series, a: FloatArray) -> list[PatternHit]:
    highs, lows = swing_highs(s, SWING_BARS), swing_lows(s, SWING_BARS)
    hits: list[PatternHit] = []
    last_confirm = -1
    hi_ptr = lo_ptr = 0
    known_h: list[Swing] = []
    known_l: list[Swing] = []
    for c in range(MIN_BARS, len(s)):
        while hi_ptr < len(highs) and highs[hi_ptr].known_at <= c:
            known_h.append(highs[hi_ptr])
            hi_ptr += 1
        while lo_ptr < len(lows) and lows[lo_ptr].known_at <= c:
            known_l.append(lows[lo_ptr])
            lo_ptr += 1
        ac = float(a[c - 1])
        if len(known_h) < 2 or len(known_l) < 2 or not np.isfinite(ac) or ac <= 0:
            continue
        hit = _formation_at(s, c, ac, known_h, known_l, last_confirm)
        if hit:
            hits.append(hit)
            last_confirm = c
    return hits


def _formation_at(
    s: Series, c: int, ac: float, known_h: list[Swing], known_l: list[Swing], last_confirm: int
) -> PatternHit | None:
    # At least five touches: three on one line, two on the other (Bulkowski; r11).
    for nh, nl in ((3, 3), (3, 2), (2, 3)):
        hs, ls = known_h[-nh:], known_l[-nl:]
        if len(hs) < nh or len(ls) < nl:
            continue
        start = min(hs[0].index, ls[0].index)
        if start <= last_confirm or not (MIN_BARS <= c - start <= MAX_BARS):
            continue
        # Swings must interleave (a pattern, not a run of highs then a run of lows).
        if max(hs[0].index, ls[0].index) > min(hs[-1].index, ls[-1].index):
            continue
        up, lo = _fit(hs), _fit(ls)
        if up.worst > TOUCH_TOL_ATR * ac or lo.worst > TOUCH_TOL_ATR * ac:
            continue
        width0, width1 = up.at(start) - lo.at(start), up.at(c) - lo.at(c)
        if width0 < MIN_HEIGHT_ATR * ac or width1 <= 0:
            continue
        span = c - start
        rise_u, rise_l = up.slope * span / ac, lo.slope * span / ac
        converging = width1 <= (1 - MIN_CONVERGENCE) * width0
        if converging:
            # The lines narrow linearly, so the share of the way to the apex is 1 - width1 /
            # width0. A breakout in the last quarter is the weak case (Edwards & Magee; Bulkowski).
            if width1 < (1 - MAX_APEX_SHARE) * width0:
                continue
            pattern = _classify(rise_u, rise_l)
        elif abs(width1 - width0) <= PARALLEL_TOL * width0:
            pattern = _classify_parallel(rise_u, rise_l)
        else:
            continue  # widening: a broadening formation, not detected
        if pattern is None:
            continue
        # Breakout: first close above the upper line; closes stayed inside until then.
        close = float(s.close[c])
        if close <= up.at(c) or float(s.close[c - 1]) > up.at(c - 1):
            continue
        xs = np.arange(start, c, dtype=np.float64)
        closes = s.close[start:c]
        tol = INSIDE_TOL_ATR * ac
        if np.any(closes > up.intercept + up.slope * xs + tol):
            continue
        if np.any(closes < lo.intercept + lo.slope * xs - tol):
            continue
        last_low = ls[-1]
        stop = last_low.price - STOP_PAD_ATR * ac
        if stop >= close:
            continue
        # Measured move: triangles the height at the start; rectangles and channels the height at
        # the breakout; a falling wedge back to where it began.
        height = width0 if converging else width1
        target = float(s.high[start : c + 1].max()) if pattern == "fallingWedge" else close + height
        if target <= close:
            continue
        return PatternHit(
            pattern=pattern,
            direction="long",
            index=c,
            entry=close,
            stop=stop,
            target=target,
            start=start,
            extreme=float(min(p.price for p in ls)),
            points=(
                *(Point(p.index, p.price, "") for p in hs),
                *(Point(p.index, p.price, "") for p in ls),
            ),
            lines=(
                Line(Point(start, up.at(start)), Point(c, up.at(c)), "Upper"),
                Line(Point(start, lo.at(start)), Point(c, lo.at(c)), "Lower"),
            ),
            formation=(start, c),
        )
    return None


BEARISH_TWIN = {
    "ascendingTriangle": "descendingTriangle",
    "descendingTriangle": "ascendingTriangle",  # an ascending triangle breaking down
    "symmetricalTriangle": "symmetricalTriangle",
    "fallingWedge": "risingWedge",
    "risingWedge": "fallingWedge",  # a falling wedge breaking down
    "rectangle": "rectangle",
    "risingChannel": "fallingChannel",  # a falling channel breaking down
    "fallingChannel": "risingChannel",  # a rising channel breaking down
}


def detect_trendline_patterns(s: Series, atrs: FloatArray | None = None) -> list[PatternHit]:
    a = atr(s) if atrs is None else atrs
    bearish = [unmirror(h, BEARISH_TWIN[h.pattern]) for h in _upward(mirror(s), a)]
    return [*_upward(s, a), *bearish]
