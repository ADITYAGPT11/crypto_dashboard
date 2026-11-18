"""Multi-timeframe playbook: a higher-timeframe setup at a level, entered on a lower timeframe.

Written once for longs; shorts run the same rule on the mirrored series (``mirror``), where a
supply zone is a demand zone and a lower low is a higher high. Nothing looks ahead: every step
uses only candles that had closed when it happened (swings only after ``known_at``).

1. **Trigger** (HTF, e.g. 4h): a pattern confirmed AT a level (location zone, order block or
   confluence). Known when its HTF candle closes; valid for ``TRIGGER_BARS`` HTF candles; dead
   once an LTF candle closes below the pattern's own stop.
2. **Confirmation** (LTF, e.g. 15m): a change of character, the first LTF close above the
   latest LTF swing high known at that time. Impulse = from the lowest low since that swing high
   to the highest high up to the CHoCH candle.
3. **Entry**, three variants:
   - ``market``: at the CHoCH candle's close;
   - ``fib``: limit at the 0.618 retracement of the impulse (inside the 0.5-0.786 band);
   - ``fvg``: limit at the top of the last bullish LTF fair value gap formed inside the impulse.
   A limit must fill within ``ENTRY_BARS`` LTF candles, else the trade is skipped.
4. **Stop**: impulse low - ``STOP_ATR`` x LTF ATR. Skipped when the risk exceeds
   ``MAX_RISK_HTF_ATR`` x HTF ATR (too wide for the setup), is not positive, or is closer than
   ``MIN_STOP_PCT`` % of the price (r4): with a tighter stop, fees and slippage alone cost more
   than about 0.1R a trade (a round trip is 0.04-0.14% of the price).
5. **Exit**, three variants:
   - ``target``: the HTF pattern's own target, or the stop;
   - ``trail``: the stop trails under each newly confirmed LTF higher low;
   - ``managed``: at +1R the stop moves to entry, at +2R half is taken, the rest trails.
   At most ``MAX_HOLD_BARS`` LTF candles, then out at the close. A candle that reaches both the
   stop and a profit level counts the stop (conservative).
6. **Costs** (Binance USD-M futures, VIP 0): maker 0.02%, taker 0.05%, plus 0.02% slippage on
   taker fills. Market entries and stop / time exits are taker; limit entries, targets and the
   partial are maker. Results are in R, net of costs.

A **random baseline** replays every trade from a random LTF candle inside the same trigger
window, entered at its close with the same stop distance, exit rule and entry fee: if the
playbook's timing adds nothing, the two records match.
"""

from __future__ import annotations

import bisect
import math
from collections.abc import Sequence
from dataclasses import dataclass, field, replace
from typing import Literal

import numpy as np

from tcs.analysis.indicators import atr
from tcs.analysis.swings import Swing, swing_highs, swing_lows
from tcs.analysis.types import Location, PatternHit
from tcs.common.series import FloatArray, Series, mirror

TRIGGER_BARS = 6
ENTRY_BARS = 12
STOP_ATR = 0.1
MAX_RISK_HTF_ATR = 1.0
MIN_STOP_PCT = 1.0
#: What a too-tight stop does: the rule skips the trade. "widen" (move the stop out to the
#: minimum) exists only to compare the two in research; it is not used by the statistics.
MIN_STOP_MODE: Literal["skip", "widen"] = "skip"
FIB_LEVEL = 0.618
MAX_HOLD_BARS = 672  # 7 days of 15m
BREAKEVEN_R = 1.0
PARTIAL_R = 2.0
PARTIAL_SHARE = 0.5
FVG_MIN_LTF_ATR = 0.1

MAKER = 0.0002
TAKER = 0.0005
SLIPPAGE = 0.0002

Entry = Literal["market", "fib", "fvg"]
Exit = Literal["target", "trail", "managed"]
ENTRIES: tuple[Entry, ...] = ("market", "fib", "fvg")
EXITS: tuple[Exit, ...] = ("target", "trail", "managed")
AT_LEVEL: tuple[Location, ...] = ("zone", "orderBlock", "confluence")

Stage = Literal["waiting", "confirmed", "expired", "invalidated"]
TradeStatus = Literal["pending", "skipped", "cancelled", "open", "closed"]
Reason = Literal["stop", "target", "trail", "breakeven", "time"]


@dataclass(frozen=True, slots=True)
class Trade:
    entry_kind: Entry
    exit_kind: Exit
    status: TradeStatus
    #: Why a trade was not taken (status skipped / cancelled), for the record.
    note: str = ""
    entry: float = math.nan
    stop: float = math.nan
    target: float | None = None
    #: LTF index of the fill, and of the exit (None while open).
    fill_index: int | None = None
    exit_index: int | None = None
    exit_price: float | None = None
    reason: Reason | None = None
    #: Stop now (open trades): where the trail or breakeven has moved it.
    stop_now: float = math.nan
    r_gross: float = 0.0
    r_net: float = 0.0
    #: Same trade from a random candle in the trigger window (closed trades only).
    baseline_r: float | None = None

    @property
    def risk(self) -> float:
        return self.entry - self.stop


@dataclass(frozen=True, slots=True)
class Trigger:
    hit: PatternHit
    location: Location
    #: LTF index of the first candle after the HTF trigger closed, and of the window's end.
    start: int
    end: int
    stage: Stage
    choch_index: int | None = None
    #: The LTF swing high the CHoCH broke.
    broke: float | None = None
    impulse_low: float | None = None
    impulse_high: float | None = None
    trades: tuple[Trade, ...] = field(default_factory=tuple)


@dataclass(slots=True)
class _Ctx:
    """Per-series data the rules share (computed once per run). Swings are in index order,
    which is also the order they become known (``known_at = index + SWING_BARS``)."""

    s: Series
    atr: FloatArray
    highs: list[Swing]
    highs_known: list[int]
    lows: list[Swing]
    lows_known: list[int]


def _ctx(s: Series) -> _Ctx:
    highs, lows = swing_highs(s), swing_lows(s)
    return _Ctx(s, atr(s), highs, [w.known_at for w in highs], lows, [w.known_at for w in lows])


def _latest_high(c: _Ctx, j: int) -> Swing | None:
    """The most recent swing high known when candle ``j`` closes."""
    k = bisect.bisect_right(c.highs_known, j)
    return c.highs[k - 1] if k > 0 else None


def _fee(maker: bool) -> float:
    """Cost as a share of the traded price. Callers multiply by abs(price): shorts run on the
    mirrored series, whose prices are negative, and a cost is a cost either way."""
    return MAKER if maker else TAKER + SLIPPAGE


def _simulate(
    c: _Ctx,
    exit_kind: Exit,
    entry: float,
    stop: float,
    target: float | None,
    fill: int,
    maker_entry: bool,
    check_fill_bar: bool,
) -> tuple[TradeStatus, int | None, float | None, Reason | None, float, float, float]:
    """Walk a filled long trade forward. Returns status, exit index, exit price, reason,
    current stop, gross R, net R."""
    s = c.s
    risk = entry - stop
    qty = 1.0
    gross = 0.0
    costs = _fee(maker_entry) * abs(entry)
    stop_now = stop
    moved_be = False
    took_partial = False
    last = len(s) - 1
    lows_i = bisect.bisect_right(c.lows_known, fill)
    first = fill if check_fill_bar else fill + 1
    for k in range(first, min(last, fill + MAX_HOLD_BARS) + 1):
        lo, hi = float(s.low[k]), float(s.high[k])
        if lo <= stop_now:
            reason: Reason = (
                "stop"
                if stop_now <= stop
                else ("breakeven" if moved_be and stop_now <= entry else "trail")
            )
            gross += qty * (stop_now - entry)
            costs += qty * _fee(False) * abs(stop_now)
            return "closed", k, stop_now, reason, stop_now, gross / risk, (gross - costs) / risk
        if k == fill and check_fill_bar:
            continue  # the fill candle can stop us out, but profits count from the next one
        if exit_kind == "target" and target is not None and hi >= target:
            gross += qty * (target - entry)
            costs += qty * _fee(True) * abs(target)
            return "closed", k, target, "target", stop_now, gross / risk, (gross - costs) / risk
        if exit_kind == "managed":
            if not took_partial and hi >= entry + PARTIAL_R * risk:
                px = entry + PARTIAL_R * risk
                gross += PARTIAL_SHARE * (px - entry)
                costs += PARTIAL_SHARE * _fee(True) * abs(px)
                qty -= PARTIAL_SHARE
                took_partial = True
            if not moved_be and hi >= entry + BREAKEVEN_R * risk:
                moved_be = True
                stop_now = max(stop_now, entry)
        if exit_kind in ("trail", "managed"):
            # Swing lows confirmed by this close, formed after the fill: trail under them.
            while lows_i < len(c.lows_known) and c.lows_known[lows_i] <= k:
                w = c.lows[lows_i]
                lows_i += 1
                a = float(c.atr[k])
                if w.index > fill and math.isfinite(a):
                    stop_now = max(stop_now, w.price - STOP_ATR * a)
        if k == fill + MAX_HOLD_BARS:
            px = float(s.close[k])
            gross += qty * (px - entry)
            costs += qty * _fee(False) * abs(px)
            return "closed", k, px, "time", stop_now, gross / risk, (gross - costs) / risk
    return "open", None, None, None, stop_now, 0.0, 0.0


def _last_fvg_top(c: _Ctx, lo_i: int, j: int) -> float | None:
    """Top of the last bullish FVG whose third candle closed inside [lo_i, j]."""
    s = c.s
    for k in range(j, max(lo_i, 2) - 1, -1):
        a = float(c.atr[k])
        if not math.isfinite(a) or a <= 0:
            continue
        if float(s.low[k]) - float(s.high[k - 2]) >= FVG_MIN_LTF_ATR * a:
            return float(s.low[k])
    return None


def _entry_price(c: _Ctx, kind: Entry, lo: float, hi: float, lo_i: int, j: int) -> float | None:
    close = float(c.s.close[j])
    if kind == "market":
        return close
    if kind == "fib":
        px = hi - FIB_LEVEL * (hi - lo)
    else:
        top = _last_fvg_top(c, lo_i, j)
        if top is None:
            return None
        px = top
    return px if px < close else None


def _trade(
    c: _Ctx,
    entry_kind: Entry,
    exit_kind: Exit,
    j: int,
    lo: float,
    hi: float,
    lo_i: int,
    target: float,
    htf_atr: float,
    window: tuple[int, int],
    seed: int,
) -> Trade:
    s = c.s
    a = float(c.atr[j])
    if not math.isfinite(a):
        return Trade(entry_kind, exit_kind, "skipped", "no ATR yet")
    stop = lo - STOP_ATR * a
    entry = _entry_price(c, entry_kind, lo, hi, lo_i, j)
    if entry is None:
        return Trade(entry_kind, exit_kind, "skipped", "no entry level")
    risk = entry - stop
    if risk <= 0 or not math.isfinite(htf_atr) or risk > MAX_RISK_HTF_ATR * htf_atr:
        return Trade(entry_kind, exit_kind, "skipped", "stop too wide", entry, stop)
    floor = MIN_STOP_PCT / 100 * abs(entry)
    if risk < floor:
        if MIN_STOP_MODE == "skip":
            return Trade(entry_kind, exit_kind, "skipped", "stop too tight for fees", entry, stop)
        stop, risk = entry - floor, floor
    tgt = target if exit_kind == "target" else None
    if tgt is not None and tgt <= entry:
        return Trade(entry_kind, exit_kind, "skipped", "target below entry", entry, stop, tgt)
    if entry_kind == "market":
        fill, maker, check = j, False, False
    else:
        fill = None
        for k in range(j + 1, min(len(s) - 1, j + ENTRY_BARS) + 1):
            if float(s.low[k]) <= entry:
                fill = k
                break
        if fill is None:
            pending = j + ENTRY_BARS > len(s) - 1
            return Trade(
                entry_kind,
                exit_kind,
                "pending" if pending else "cancelled",
                "" if pending else "no pullback in time",
                entry,
                stop,
                tgt,
                stop_now=stop,
            )
        maker, check = True, True
    status, xi, xp, reason, stop_now, rg, rn = _simulate(
        c, exit_kind, entry, stop, tgt, fill, maker, check
    )
    t = Trade(
        entry_kind, exit_kind, status, "", entry, stop, tgt, fill, xi, xp, reason, stop_now, rg, rn
    )
    if status == "closed":
        t = replace(t, baseline_r=_baseline(c, exit_kind, risk, tgt, entry, window, seed, maker))
    return t


def _baseline(
    c: _Ctx,
    exit_kind: Exit,
    risk: float,
    target: float | None,
    entry: float,
    window: tuple[int, int],
    seed: int,
    maker_entry: bool,
) -> float | None:
    """The same trade from a random candle in the trigger window, entered at its close and
    charged the same entry fee as the real trade, so the difference is timing, not fees."""
    lo_i, hi_i = window
    if hi_i <= lo_i:
        return None
    k = int(np.random.default_rng(seed).integers(lo_i, hi_i))
    px = float(c.s.close[k])
    tgt = None if target is None else px + (target - entry)
    status, _, _, _, _, _, rn = _simulate(c, exit_kind, px, px - risk, tgt, k, maker_entry, False)
    return rn if status == "closed" else None


def _long(
    htf: Series, htf_atr: FloatArray, c: _Ctx, hit: PatternHit, location: Location
) -> Trigger:
    """The rule for a long setup (``htf`` gives only times; prices come from ``hit`` and the
    LTF context, mirrored for shorts)."""
    s = c.s
    known = htf.close_time(hit.index)
    start = int(np.searchsorted(s.open_time, known, side="left"))
    end = int(np.searchsorted(s.open_time, known + TRIGGER_BARS * htf.tf_ms, side="left"))
    end = min(end, len(s))
    base = Trigger(hit, location, start, end, "waiting")
    for j in range(start, end):
        close = float(s.close[j])
        if close < hit.stop:
            return replace(base, stage="invalidated")
        sh = _latest_high(c, j)
        if sh is None or j == 0:
            continue
        if not (float(s.close[j - 1]) <= sh.price < close):
            continue
        lo_i = sh.index + int(np.argmin(s.low[sh.index : j + 1]))
        lo = float(s.low[lo_i])
        hi = float(np.max(s.high[lo_i : j + 1]))
        seed = (int(s.open_time[j]) // 60_000) % (2**32)
        trades = tuple(
            _trade(
                c, e, x, j, lo, hi, lo_i, hit.target, float(htf_atr[hit.index]), (start, end), seed
            )
            for e in ENTRIES
            for x in EXITS
        )
        return replace(
            base,
            stage="confirmed",
            choch_index=j,
            broke=sh.price,
            impulse_low=lo,
            impulse_high=hi,
            trades=trades,
        )
    # Not confirmed: the window is over if candles after it exist, else still waiting.
    return replace(base, stage="expired" if end < len(s) else "waiting")


def _flip_hit(h: PatternHit) -> PatternHit:
    return replace(
        h, direction="long", entry=-h.entry, stop=-h.stop, target=-h.target, extreme=-h.extreme
    )


def _flip_trigger(t: Trigger, original: PatternHit) -> Trigger:
    """A trigger found on the mirrored series, in the original (short) prices."""

    def neg(x: float | None) -> float | None:
        return None if x is None else -x

    trades = tuple(
        replace(
            tr,
            entry=-tr.entry,
            stop=-tr.stop,
            target=neg(tr.target),
            exit_price=neg(tr.exit_price),
            stop_now=-tr.stop_now,
        )
        for tr in t.trades
    )
    return replace(
        t,
        hit=original,
        broke=neg(t.broke),
        impulse_low=neg(t.impulse_low),
        impulse_high=neg(t.impulse_high),
        trades=trades,
    )


def run_playbook(
    htf: Series, ltf: Series, setups: Sequence[tuple[PatternHit, Location]]
) -> list[Trigger]:
    """Every HTF setup at a level, followed through the LTF. ``setups`` are HTF pattern hits
    with their location (from ``engine.analyze`` on the HTF series)."""
    at_level: list[tuple[PatternHit, Location]] = [(h, at) for h, at in setups if at in AT_LEVEL]
    if not at_level or len(ltf) == 0:
        return []
    htf_atr = atr(htf)  # ATR is the same on the mirrored series
    up = _ctx(ltf)
    down: _Ctx | None = None
    out: list[Trigger] = []
    for hit, loc in at_level:
        if hit.direction == "long":
            out.append(_long(htf, htf_atr, up, hit, loc))
        else:
            down = down or _ctx(mirror(ltf))
            t = _long(htf, htf_atr, down, _flip_hit(hit), loc)
            out.append(_flip_trigger(t, hit))
    return out
