"""Reversal and continuation chart patterns built on confirmed swings.

Each rule is written once for the bullish case. The bearish twin is the same
rule run on the mirrored series (``tcs.common.series.mirror``), so a double top
is, by construction, a double bottom upside down.

All distances are in ATR(14) measured on the swing or confirmation candle.
A pattern confirms on the FIRST close beyond its trigger line after its last
swing became known (``SWING_BARS`` candles later): never earlier, so the
confirmation only uses candles that existed then.
"""

from __future__ import annotations

import numpy as np

from tcs.analysis.indicators import atr
from tcs.analysis.mirroring import unmirror
from tcs.analysis.swings import SWING_BARS, Swing, swing_lows
from tcs.analysis.types import Line, PatternHit, Point
from tcs.common.series import FloatArray, Series, mirror

# Double bottom (Bulkowski: two bottoms near the same price, a meaningful rise between)
DB_MIN_GAP, DB_MAX_GAP = 6, 60  # candles between the two lows
DB_LOW_TOL_ATR = 0.6  # lows within this distance of each other
DB_MIN_HEIGHT_ATR = 1.5  # peak between the lows at least this far above them
DB_CONFIRM_WITHIN = 20  # candles after the second low
# Inverse head and shoulders (Edwards & Magee ch. 6)
HS_MIN_GAP, HS_MAX_GAP = 3, 40  # candles between shoulder and head
HS_HEAD_DEPTH_ATR = 0.5  # head at least this far below both shoulders
HS_SHOULDER_TOL_ATR = 1.0  # shoulders within this distance of each other
HS_MIN_HEIGHT_ATR = 1.5  # neckline above the head, at the head
HS_SHOULDER_CLEAR_ATR = 0.5  # each shoulder at least this far below the neckline
HS_CONFIRM_WITHIN = 25
# Bull flag (Edwards & Magee ch. 11: a fast, nearly vertical pole, a short pause)
FLAG_POLE_MIN_ATR = 3.0
FLAG_POLE_BARS = (3, 15)
FLAG_MIN_BARS = 3  # pause candles before a breakout counts
FLAG_MAX_BARS = 20
FLAG_MAX_RETRACE = 0.5  # pause gives back at most half the pole
# Shared plan
STOP_PAD_ATR = 0.2


def _finite(x: float) -> bool:
    return bool(np.isfinite(x)) and x > 0


def double_bottoms(s: Series, a: FloatArray, lows: list[Swing]) -> list[PatternHit]:
    """Two swing lows within ``DB_LOW_TOL_ATR``; confirmed on a close above the peak between.

    Entry = confirmation close; stop = lower low - 0.2 ATR; target = neckline + height.
    """
    hits: list[PatternHit] = []
    last_confirm = -1
    n = len(s)
    for p in range(1, len(lows)):
        second = lows[p]
        i2 = second.index
        a2 = float(a[i2])
        if not _finite(a2):
            continue
        for q in range(p - 1, -1, -1):
            first = lows[q]
            i1 = first.index
            gap = i2 - i1
            if gap < DB_MIN_GAP:
                continue
            if gap > DB_MAX_GAP:
                break
            if abs(first.price - second.price) > DB_LOW_TOL_ATR * a2:
                continue
            bottom = min(first.price, second.price)
            if float(s.low[i1 : i2 + 1].min()) < bottom - 1e-12:
                continue  # a lower low between: not a double bottom
            neck_idx = i1 + int(np.argmax(s.high[i1 : i2 + 1]))
            neckline = float(s.high[neck_idx])
            if neckline - max(first.price, second.price) < DB_MIN_HEIGHT_ATR * a2:
                continue
            for c in range(i2 + 1, min(i2 + DB_CONFIRM_WITHIN, n - 1) + 1):
                close = float(s.close[c])
                if close < bottom:
                    break  # failed before confirming
                if close > neckline:
                    if c >= second.known_at and c > last_confirm:
                        ac = float(a[c]) if _finite(float(a[c])) else a2
                        hits.append(
                            PatternHit(
                                pattern="doubleBottom",
                                direction="long",
                                index=c,
                                entry=close,
                                stop=bottom - STOP_PAD_ATR * ac,
                                target=neckline + (neckline - bottom),
                                start=i1,
                                extreme=bottom,
                                points=(
                                    Point(i1, first.price, "Low 1"),
                                    Point(neck_idx, neckline, "Peak"),
                                    Point(i2, second.price, "Low 2"),
                                ),
                                lines=(
                                    Line(Point(neck_idx, neckline), Point(c, neckline), "Neckline"),
                                ),
                            )
                        )
                        last_confirm = c
                    break  # first close above the neckline decides (before known = no signal)
            break  # nearest qualifying first low only
    return hits


def inverse_head_shoulders(s: Series, a: FloatArray, lows: list[Swing]) -> list[PatternHit]:
    """Three swing lows, the head lowest; the neckline joins the peaks between and may slope.

    Entry = confirmation close; stop = right shoulder - 0.2 ATR;
    target = neckline at confirmation + (neckline at the head - head).
    """
    hits: list[PatternHit] = []
    last_confirm = -1
    n = len(s)

    def peak_between(i: int, j: int) -> int:
        return i + 1 + int(np.argmax(s.high[i + 1 : j]))

    for r in range(2, len(lows)):
        right = lows[r]
        i_r = right.index
        ar = float(a[i_r])
        if not _finite(ar) or i_r <= last_confirm:
            continue
        found: PatternHit | None = None
        for h in range(r - 1, 0, -1):
            if found:
                break
            head = lows[h]
            i_h = head.index
            if i_r - i_h > HS_MAX_GAP:
                break
            if i_r - i_h < HS_MIN_GAP or head.price > right.price - HS_HEAD_DEPTH_ATR * ar:
                continue
            for lft in range(h - 1, -1, -1):
                left = lows[lft]
                i_l = left.index
                if i_h - i_l > HS_MAX_GAP:
                    break
                if i_h - i_l < HS_MIN_GAP:
                    continue
                if left.price < head.price + HS_HEAD_DEPTH_ATR * ar:
                    continue
                if abs(left.price - right.price) > HS_SHOULDER_TOL_ATR * ar:
                    continue
                if float(s.low[i_l : i_r + 1].min()) < head.price - 1e-12:
                    continue
                i_p1, i_p2 = peak_between(i_l, i_h), peak_between(i_h, i_r)
                p1, p2 = float(s.high[i_p1]), float(s.high[i_p2])
                slope = (p2 - p1) / (i_p2 - i_p1)

                def neck(i: int, p1: float = p1, i_p1: int = i_p1, slope: float = slope) -> float:
                    return p1 + slope * (i - i_p1)

                depth = neck(i_h) - head.price
                if depth < HS_MIN_HEIGHT_ATR * ar:
                    continue
                if left.price > neck(i_l) - HS_SHOULDER_CLEAR_ATR * ar:
                    continue
                if right.price > neck(i_r) - HS_SHOULDER_CLEAR_ATR * ar:
                    continue
                for c in range(i_r + 1, min(i_r + HS_CONFIRM_WITHIN, n - 1) + 1):
                    close = float(s.close[c])
                    if close < right.price:
                        break  # right shoulder broke first
                    if close > neck(c):
                        if c >= right.known_at:
                            ac = float(a[c]) if _finite(float(a[c])) else ar
                            found = PatternHit(
                                pattern="inverseHeadShoulders",
                                direction="long",
                                index=c,
                                entry=close,
                                stop=right.price - STOP_PAD_ATR * ac,
                                target=neck(c) + depth,
                                start=i_l,
                                extreme=head.price,
                                points=(
                                    Point(i_l, left.price, "Left shoulder"),
                                    Point(i_p1, p1, ""),
                                    Point(i_h, head.price, "Head"),
                                    Point(i_p2, p2, ""),
                                    Point(i_r, right.price, "Right shoulder"),
                                ),
                                lines=(Line(Point(i_p1, p1), Point(c, neck(c)), "Neckline"),),
                            )
                        break
                if found:
                    break
        if found:
            hits.append(found)
            last_confirm = found.index
    return hits


def bull_flags(s: Series, a: FloatArray) -> list[PatternHit]:
    """A pole of at least 3 ATR in 3-15 candles, a pause giving back at most half of it.

    The pole top is the highest high of the previous 15 candles. Confirmed on the
    first close above the pause's highest high, 4-20 candles after the top.
    Entry = confirmation close; stop = pause low - 0.2 ATR; target = entry + pole.
    """
    hits: list[PatternHit] = []
    last_confirm = -1
    n = len(s)
    lo_bars, hi_bars = FLAG_POLE_BARS
    for t in range(hi_bars, n):
        at = float(a[t])
        if not _finite(at) or t <= last_confirm:
            continue
        top = float(s.high[t])
        if float(s.high[t - hi_bars : t].max()) >= top:
            continue
        base = t - hi_bars + int(np.argmin(s.low[t - hi_bars : t - lo_bars + 1]))
        pole = top - float(s.low[base])
        if t - base < lo_bars or pole < FLAG_POLE_MIN_ATR * at:
            continue
        flag_low, flag_low_idx, flag_high = float("inf"), t, float("-inf")
        for f in range(t + 1, min(t + FLAG_MAX_BARS, n - 1) + 1):
            close = float(s.close[f])
            if f - t > FLAG_MIN_BARS and close > flag_high:
                af = float(a[f]) if _finite(float(a[f])) else at
                hits.append(
                    PatternHit(
                        pattern="bullFlag",
                        direction="long",
                        index=f,
                        entry=close,
                        stop=flag_low - STOP_PAD_ATR * af,
                        target=close + pole,
                        start=base,
                        extreme=flag_low,
                        points=(
                            Point(base, float(s.low[base]), "Pole"),
                            Point(t, top, "Top"),
                            Point(flag_low_idx, flag_low, "Flag low"),
                        ),
                        lines=(Line(Point(t + 1, flag_high), Point(f, flag_high), "Flag high"),),
                    )
                )
                last_confirm = f
                break
            if close > top:
                break  # still the pole (or a new top), not a pause
            if float(s.low[f]) < flag_low:
                flag_low, flag_low_idx = float(s.low[f]), f
            if flag_low < top - FLAG_MAX_RETRACE * pole:
                break  # gave back too much
            flag_high = max(flag_high, float(s.high[f]))
    return hits


BEARISH_TWIN = {
    "doubleBottom": "doubleTop",
    "inverseHeadShoulders": "headShoulders",
    "bullFlag": "bearFlag",
}


def _bullish(s: Series, a: FloatArray) -> list[PatternHit]:
    lows = swing_lows(s, SWING_BARS)
    return [*double_bottoms(s, a, lows), *inverse_head_shoulders(s, a, lows), *bull_flags(s, a)]


def detect_chart_patterns(s: Series, atrs: FloatArray | None = None) -> list[PatternHit]:
    a = atr(s) if atrs is None else atrs
    bearish = [unmirror(h, BEARISH_TWIN[h.pattern]) for h in _bullish(mirror(s), a)]
    return [*_bullish(s, a), *bearish]
