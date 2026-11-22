"""Setup checklist: six yes/no facts about where and how a pattern formed, counted 0-6.

A plain checklist chosen by the owner (2026-11-22), shown on the chart as "4/6 checks". It is an
OBSERVATION of the context at the confirmation candle, not a measured probability and not a
prediction: nothing here has been backtested (``docs/context/DECISIONS.md``).

Written for bullish setups; bearish setups use the mirror (below VWAP, RSI 30-50, Supertrend
down, a bearish order block or supply zone). Every value uses only candles up to the
confirmation candle.

- **location**: the pattern formed at an intact bullish order block or demand zone
  (``location.py``: zone, order block or both).
- **rsi**: RSI(14) between ``RSI_LOW`` and ``RSI_HIGH``: momentum on the pattern's side without
  being stretched; above ``RSI_HIGH`` the check fails and is marked overbought.
- **volume**: the confirmation candle traded at least ``VOLUME_SPIKE`` x the mean volume of the
  ``VOLUME_BARS`` candles before it.
- **vwap**: the confirmation close is above the rolling VWAP(``VWAP_BARS``).
- **atr**: volatility is expanding: ATR(14) at or above its own ``ATR_AVG_BARS``-candle mean.
- **supertrend**: Supertrend(``ST_PERIOD``, ``ST_MULT``) points the pattern's way.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

import numpy as np

from tcs.analysis.indicators import atr, rolling_vwap, rsi, sma, supertrend
from tcs.analysis.types import Location, PatternHit
from tcs.common.series import Series

RSI_LOW, RSI_HIGH = 50.0, 70.0
VOLUME_SPIKE = 1.5
VOLUME_BARS = 20
VWAP_BARS = 20
ATR_AVG_BARS = 50
ST_PERIOD, ST_MULT = 10, 3.0

CHECK_IDS: tuple[str, ...] = ("location", "rsi", "volume", "vwap", "atr", "supertrend")
MAX_SCORE = len(CHECK_IDS)


@dataclass(frozen=True, slots=True)
class Check:
    id: str
    label: str
    passed: bool
    #: What was observed, e.g. "RSI 63", "volume 2.1x average", "overbought (RSI 76)".
    detail: str


@dataclass(frozen=True, slots=True)
class Checklist:
    checks: tuple[Check, ...]

    @property
    def score(self) -> int:
        return sum(c.passed for c in self.checks)


class _Side:
    """Indicators of one direction: the series itself for longs, its mirror for shorts."""

    def __init__(self, s: Series) -> None:
        self.close = s.close
        self.rsi = rsi(s.close)
        self.vwap = rolling_vwap(s, VWAP_BARS)
        self.trend = supertrend(s, ST_PERIOD, ST_MULT)


def checker(s: Series, mirrored: Series | None) -> Callable[[PatternHit, Location], Checklist]:
    """Build once per series; returns the checklist of any setup on it."""
    long = _Side(s)
    short = _Side(mirrored) if mirrored is not None else None
    a = atr(s)
    a_avg = sma(a, ATR_AVG_BARS)
    vol = s.volume
    vol_avg = sma(vol, VOLUME_BARS)

    def check(hit: PatternHit, location: Location) -> Checklist:
        bull = hit.direction == "long"
        side = long if bull else short
        if side is None:
            raise ValueError("a short setup needs the mirrored series")
        i = hit.index
        level = "bullish order block / demand zone" if bull else "bearish order block / supply zone"
        at_level = location != "openSpace"
        where = {
            "confluence": "a zone + order block",
            "zone": "a zone",
            "orderBlock": "an order block",
        }

        r = float(side.rsi[i])
        r_show = r if bull else 100 - r  # the mirror's RSI is 100 - RSI
        rsi_ok = bool(np.isfinite(r) and RSI_LOW <= r <= RSI_HIGH)
        if not np.isfinite(r):
            rsi_txt = "RSI not available yet"
        elif r > RSI_HIGH:
            rsi_txt = f"{'overbought' if bull else 'oversold'} (RSI {r_show:.0f})"
        else:
            rsi_txt = f"RSI {r_show:.0f}"

        base = float(vol_avg[i - 1]) if i >= 1 else float("nan")
        ratio = float(vol[i]) / base if np.isfinite(base) and base > 0 else float("nan")
        vol_ok = bool(np.isfinite(ratio) and ratio >= VOLUME_SPIKE)

        vw = float(side.vwap[i])
        vwap_ok = bool(np.isfinite(vw) and side.close[i] > vw)

        ai, aa = float(a[i]), float(a_avg[i])
        atr_ok = bool(np.isfinite(ai) and np.isfinite(aa) and ai >= aa)

        st_ok = bool(side.trend[i] > 0)
        st_txt = "Supertrend up" if (side.trend[i] > 0) == bull else "Supertrend down"
        if side.trend[i] == 0:
            st_txt = "Supertrend not available yet"

        return Checklist(
            (
                Check(
                    "location",
                    f"At a {level}",
                    at_level,
                    f"at {where[location]}" if at_level else "open space",
                ),
                Check(
                    "rsi",
                    f"RSI {('50-70' if bull else '30-50')}: healthy momentum",
                    rsi_ok,
                    rsi_txt,
                ),
                Check(
                    "volume",
                    "Volume spike on the confirmation candle",
                    vol_ok,
                    f"volume {ratio:.1f}x average"
                    if np.isfinite(ratio)
                    else "no volume average yet",
                ),
                Check(
                    "vwap",
                    f"Close {'above' if bull else 'below'} VWAP",
                    vwap_ok,
                    "VWAP not available yet"
                    if not np.isfinite(vw)
                    else f"close {('above' if bull else 'below') if vwap_ok else 'on the wrong side of'} VWAP",
                ),
                Check(
                    "atr",
                    "Volatility expanding (ATR above its average)",
                    atr_ok,
                    f"ATR {ai / aa:.2f}x its average"
                    if np.isfinite(ai) and np.isfinite(aa) and aa > 0
                    else "ATR average not available yet",
                ),
                Check("supertrend", f"Supertrend {'up' if bull else 'down'}", st_ok, st_txt),
            )
        )

    return check
