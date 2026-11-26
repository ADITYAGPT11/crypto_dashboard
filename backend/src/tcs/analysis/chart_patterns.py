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
from tcs.analysis.swings import SWING_BARS, Swing, swing_highs, swing_lows
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
HS_MAX_WIDTH_RATIO = 2.0  # one side (shoulder to head) at most twice as long as the other (r12)
# Bull flag (Edwards & Magee ch. 11: a fast, nearly vertical pole, a short pause)
FLAG_POLE_MIN_ATR = 3.0
FLAG_POLE_BARS = (3, 15)
FLAG_MIN_BARS = 3  # pause candles before a breakout counts
FLAG_MAX_BARS = 20
FLAG_MAX_RETRACE = 0.5  # pause gives back at most half the pole
PENNANT_CONVERGE_ATR = 0.25  # pennant: highs' line falls and lows' line rises at least this much
# Cup with handle (Bulkowski: a U-shaped cup between rims near one price, a handle in its
# upper half; Bulkowski's daily cups run 7-65 weeks, here in candles)
CUP_MIN_BARS, CUP_MAX_BARS = 20, 150  # left rim to right rim
CUP_MIN_DEPTH_ATR = 3.0  # lower rim to the cup's low
CUP_RIM_TOL = 0.15  # rims within this share of the depth of each other
CUP_U_SHARE = 0.6  # at least this share of the cup's closes in its lower half (U, not V)
CUP_HANDLE_MIN_BARS = 3
CUP_HANDLE_DIP_ATR = 0.5  # the handle pulls back at least this far below the right rim
# Reversal patterns need a trend to reverse (Bulkowski: "prices trend downward into the pattern")
PRIOR_BARS = 20  # the first low is compared with the close this many candles earlier
PRIOR_TREND_ATR = 2.0  # ... and must lie at least this far below it
# Shared plan
STOP_PAD_ATR = 0.2


def _finite(x: float) -> bool:
    return bool(np.isfinite(x)) and x > 0


def _not_rising(closes: FloatArray) -> bool:
    """Least-squares slope of the closes is zero or negative."""
    x = np.arange(closes.shape[0], dtype=np.float64)
    dx = x - x.mean()
    return float((dx * (closes - closes.mean())).sum()) <= 0


def _fit_line(values: FloatArray, x0: int) -> tuple[float, float]:
    """Least-squares line through ``values`` at x = x0, x0 + 1, ...: (slope, value at x0)."""
    x = np.arange(values.shape[0], dtype=np.float64)
    dx = x - x.mean()
    slope = float((dx * (values - values.mean())).sum() / (dx * dx).sum())
    return slope, float(values.mean() - slope * x.mean())


def _trend_into(s: Series, a: FloatArray, first: Swing) -> bool:
    """Price fell into the pattern: its first low is well below the close ``PRIOR_BARS`` before."""
    i = first.index
    if i - PRIOR_BARS < 0 or not _finite(float(a[i])):
        return False
    return float(s.close[i - PRIOR_BARS]) - first.price >= PRIOR_TREND_ATR * float(a[i])


def double_bottoms(s: Series, a: FloatArray, lows: list[Swing]) -> list[PatternHit]:
    """Two swing lows within ``DB_LOW_TOL_ATR``; confirmed on a close above the peak between.

    Price must fall into the first low (``_trend_into``). Entry = confirmation close;
    stop = lower low - 0.2 ATR; target = neckline + height (skipped when already passed).
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
            # The peak is the highest high strictly between the two lows' candles: a rally of
            # its own, never the wick of a low's candle (r11).
            neck_idx = i1 + 1 + int(np.argmax(s.high[i1 + 1 : i2]))
            neckline = float(s.high[neck_idx])
            if neckline - max(first.price, second.price) < DB_MIN_HEIGHT_ATR * a2:
                continue
            if not _trend_into(s, a, first):
                continue
            for c in range(i2 + 1, min(i2 + DB_CONFIRM_WITHIN, n - 1) + 1):
                close = float(s.close[c])
                if close < bottom:
                    break  # failed before confirming
                if close > neckline:
                    target = neckline + (neckline - bottom)
                    if c >= second.known_at and c > last_confirm and target > close:
                        ac = float(a[c]) if _finite(float(a[c])) else a2
                        hits.append(
                            PatternHit(
                                pattern="doubleBottom",
                                direction="long",
                                index=c,
                                entry=close,
                                stop=bottom - STOP_PAD_ATR * ac,
                                target=target,
                                start=i1,
                                extreme=bottom,
                                points=(
                                    Point(i1, first.price, "Bottom 1"),
                                    Point(neck_idx, neckline, "Peak"),
                                    Point(i2, second.price, "Bottom 2"),
                                ),
                                lines=(
                                    Line(Point(neck_idx, neckline), Point(c, neckline), "Neckline"),
                                ),
                            )
                        )
                        last_confirm = c
                    # The first close above the neckline decides: before the low is known, or
                    # already past the target (the measured move is spent) = no signal.
                    break
            break  # nearest qualifying first low only
    return hits


def triple_bottoms(s: Series, a: FloatArray, lows: list[Swing]) -> list[PatternHit]:
    """Three swing lows near one price, a real rally between each pair (r13; Bulkowski).

    The double bottom's rules with a third low: all three within ``DB_LOW_TOL_ATR``, each gap
    ``DB_MIN_GAP``-``DB_MAX_GAP`` candles, no lower low, both peaks (strictly between the lows'
    candles) at least ``DB_MIN_HEIGHT_ATR`` above the lows, price falling into the first low.
    Confirmed on the first close above the higher peak (Bulkowski: "above the highest peak").
    Entry = confirmation close; stop = lowest low - 0.2 ATR; target = neckline + height.
    """
    hits: list[PatternHit] = []
    last_confirm = -1
    n = len(s)

    def peak(i: int, j: int) -> int:
        return i + 1 + int(np.argmax(s.high[i + 1 : j]))

    for r in range(2, len(lows)):
        third = lows[r]
        i3 = third.index
        a3 = float(a[i3])
        if not _finite(a3) or i3 <= last_confirm:
            continue
        found: PatternHit | None = None
        for m in range(r - 1, 0, -1):
            second = lows[m]
            i2 = second.index
            if i3 - i2 > DB_MAX_GAP:
                break
            if i3 - i2 < DB_MIN_GAP:
                continue
            for f in range(m - 1, -1, -1):
                first = lows[f]
                i1 = first.index
                if i2 - i1 > DB_MAX_GAP:
                    break
                if i2 - i1 < DB_MIN_GAP:
                    continue
                prices = (first.price, second.price, third.price)
                if max(prices) - min(prices) > DB_LOW_TOL_ATR * a3:
                    continue
                bottom = min(prices)
                if float(s.low[i1 : i3 + 1].min()) < bottom - 1e-12:
                    continue
                p1, p2 = peak(i1, i2), peak(i2, i3)
                h1, h2 = float(s.high[p1]), float(s.high[p2])
                if min(h1, h2) - max(prices) < DB_MIN_HEIGHT_ATR * a3:
                    continue
                if not _trend_into(s, a, first):
                    continue
                neck_idx, neckline = (p1, h1) if h1 >= h2 else (p2, h2)
                for c in range(i3 + 1, min(i3 + DB_CONFIRM_WITHIN, n - 1) + 1):
                    close = float(s.close[c])
                    if close < bottom:
                        break
                    if close > neckline:
                        target = neckline + (neckline - bottom)
                        if c >= third.known_at and c > last_confirm and target > close:
                            ac = float(a[c]) if _finite(float(a[c])) else a3
                            found = PatternHit(
                                pattern="tripleBottom",
                                direction="long",
                                index=c,
                                entry=close,
                                stop=bottom - STOP_PAD_ATR * ac,
                                target=target,
                                start=i1,
                                extreme=bottom,
                                points=(
                                    Point(i1, first.price, "Bottom 1"),
                                    Point(p1, h1, "Peak"),
                                    Point(i2, second.price, "Bottom 2"),
                                    Point(p2, h2, "Peak"),
                                    Point(i3, third.price, "Bottom 3"),
                                ),
                                lines=(
                                    Line(Point(neck_idx, neckline), Point(c, neckline), "Neckline"),
                                ),
                            )
                        break
                if found:
                    break
            if found:
                break
        if found:
            hits.append(found)
            last_confirm = found.index
    return hits


def cups_with_handle(s: Series, a: FloatArray, highs: list[Swing]) -> list[PatternHit]:
    """A rounded cup between two swing-high rims, then a handle; confirmed above the right rim.

    Rims: confirmed swing highs ``CUP_MIN_BARS``-``CUP_MAX_BARS`` apart, within ``CUP_RIM_TOL``
    of the depth of each other, nothing between them higher than the lower rim. Cup: at least
    ``CUP_MIN_DEPTH_ATR`` deep and U-shaped (``CUP_U_SHARE`` of its closes in its lower half;
    a V spends half its time there). Handle: from the right rim, at least
    ``CUP_HANDLE_MIN_BARS`` candles and at most half the cup's length, dipping at least
    ``CUP_HANDLE_DIP_ATR`` and never closing below the cup's middle. Confirmed on the first close
    above the right rim. Entry = that close; stop = handle low - 0.2 ATR; target = + depth.
    """
    hits: list[PatternHit] = []
    last_confirm = -1
    n = len(s)
    for r in range(1, len(highs)):
        right = highs[r]
        i_r = right.index
        if i_r <= last_confirm:
            continue
        found: PatternHit | None = None
        for q in range(r - 1, -1, -1):
            left = highs[q]
            i_l = left.index
            if i_r - i_l > CUP_MAX_BARS:
                break
            if i_r - i_l < CUP_MIN_BARS:
                continue
            ar = float(a[i_r])
            if not _finite(ar):
                break
            rim = min(left.price, right.price)
            if float(s.high[i_l + 1 : i_r].max()) > rim:
                continue  # something inside the cup rose above its rims
            i_b = i_l + 1 + int(np.argmin(s.low[i_l + 1 : i_r]))
            bottom = float(s.low[i_b])
            depth = rim - bottom
            if (
                depth < CUP_MIN_DEPTH_ATR * ar
                or abs(left.price - right.price) > CUP_RIM_TOL * depth
            ):
                continue
            mid = bottom + depth / 2
            if float(np.mean(s.close[i_l + 1 : i_r] < mid)) < CUP_U_SHARE:
                continue  # a V, not a U
            handle_low, i_h = float("inf"), i_r
            for f in range(i_r + 1, min(i_r + (i_r - i_l) // 2, n - 1) + 1):
                close = float(s.close[f])
                if close > right.price:
                    long_enough = f - i_r - 1 >= CUP_HANDLE_MIN_BARS
                    if long_enough and right.price - handle_low >= CUP_HANDLE_DIP_ATR * ar:
                        af = float(a[f]) if _finite(float(a[f])) else ar
                        found = PatternHit(
                            pattern="cupWithHandle",
                            direction="long",
                            index=f,
                            entry=close,
                            stop=handle_low - STOP_PAD_ATR * af,
                            target=close + depth,
                            start=i_l,
                            extreme=handle_low,
                            points=(
                                Point(i_l, left.price, "Left rim"),
                                Point(i_b, bottom, "Cup low"),
                                Point(i_r, right.price, "Right rim"),
                                Point(i_h, handle_low, "Handle low"),
                            ),
                            lines=(Line(Point(i_l, right.price), Point(f, right.price), "Rim"),),
                        )
                    break
                if close < mid:
                    break  # the handle fell into the cup's lower half
                if float(s.low[f]) < handle_low:
                    handle_low, i_h = float(s.low[f]), f
            if found:
                break
        if found:
            hits.append(found)
            last_confirm = found.index
    return hits


def inverse_head_shoulders(s: Series, a: FloatArray, lows: list[Swing]) -> list[PatternHit]:
    """Three swing lows, the head lowest; the neckline joins the peaks between and may slope.

    Price must fall into the left shoulder (``_trend_into``); a breakout already past the
    target gives no signal.

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
                # Shoulders alike in width (Bulkowski): neither side more than twice the other.
                wide, narrow = max(i_h - i_l, i_r - i_h), min(i_h - i_l, i_r - i_h)
                if wide > HS_MAX_WIDTH_RATIO * narrow:
                    continue
                if not _trend_into(s, a, left):
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
                        if c >= right.known_at and neck(c) + depth > close:
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

    The pause drifts sideways or against the pole: the least-squares slope of its closes is not
    positive (Edwards & Magee: a flag slopes against the trend).

    The pole top is the highest high of the previous 15 candles. Confirmed on the
    first close above the pause's highest high, 4-20 candles after the top.
    Entry = confirmation close; stop = pause low - 0.2 ATR; target = entry + pole.

    **Pennant** (r13; Bulkowski: a short pause between converging lines): the same rule, named
    a pennant when the least-squares line of the pause's highs falls and that of its lows rises,
    each by at least ``PENNANT_CONVERGE_ATR`` ATR; drawn with those two lines.
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
            if f - t > FLAG_MIN_BARS and close > flag_high and _not_rising(s.close[t + 1 : f]):
                af = float(a[f]) if _finite(float(a[f])) else at
                k = f - t - 2  # the pause's last candle, counted from its first (t + 1)
                hs, hi0 = _fit_line(s.high[t + 1 : f], t + 1)
                ls, lo0 = _fit_line(s.low[t + 1 : f], t + 1)
                pennant = (
                    -hs * k >= PENNANT_CONVERGE_ATR * af and ls * k >= PENNANT_CONVERGE_ATR * af
                )
                if pennant:
                    pattern = "bullPennant"
                    points = (Point(base, float(s.low[base]), "Pole"), Point(t, top, "Top"))
                    lines = (
                        Line(Point(t + 1, hi0), Point(f, hi0 + hs * (k + 1)), "Upper"),
                        Line(Point(t + 1, lo0), Point(f, lo0 + ls * (k + 1)), "Lower"),
                    )
                else:
                    pattern = "bullFlag"
                    points = (
                        Point(base, float(s.low[base]), "Pole"),
                        Point(t, top, "Top"),
                        Point(flag_low_idx, flag_low, "Flag low"),
                    )
                    lines = (Line(Point(t + 1, flag_high), Point(f, flag_high), "Flag high"),)
                hits.append(
                    PatternHit(
                        pattern=pattern,
                        direction="long",
                        index=f,
                        entry=close,
                        stop=flag_low - STOP_PAD_ATR * af,
                        target=close + pole,
                        start=base,
                        extreme=flag_low,
                        points=points,
                        lines=lines,
                        formation=(t + 1, f),
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
    "tripleBottom": "tripleTop",
    "inverseHeadShoulders": "headShoulders",
    "bullFlag": "bearFlag",
    "bullPennant": "bearPennant",
    "cupWithHandle": "invertedCupWithHandle",
}


def _bullish(s: Series, a: FloatArray) -> list[PatternHit]:
    lows = swing_lows(s, SWING_BARS)
    triples = triple_bottoms(s, a, lows)
    # A triple bottom's breakout also completes a double bottom of two of its lows: one name.
    taken = {h.index for h in triples}
    doubles = [h for h in double_bottoms(s, a, lows) if h.index not in taken]
    highs = swing_highs(s, SWING_BARS)
    return [
        *doubles,
        *triples,
        *inverse_head_shoulders(s, a, lows),
        *bull_flags(s, a),
        *cups_with_handle(s, a, highs),
    ]


def detect_chart_patterns(s: Series, atrs: FloatArray | None = None) -> list[PatternHit]:
    a = atr(s) if atrs is None else atrs
    bearish = [unmirror(h, BEARISH_TWIN[h.pattern]) for h in _bullish(mirror(s), a)]
    return [*_bullish(s, a), *bearish]
