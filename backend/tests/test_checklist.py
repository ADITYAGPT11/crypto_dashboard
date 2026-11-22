"""Setup checklist (``checklist.py``) and its indicators: one fixture per check, mirrored twin."""

from __future__ import annotations

import numpy as np

from tcs.analysis.checklist import MAX_SCORE, checker
from tcs.analysis.indicators import rolling_vwap, supertrend
from tcs.analysis.types import Location, PatternHit
from tcs.common.series import Candle, Series, mirror
from tcs.common.timeframes import TF_MS

N = 120


def series(closes: list[float], volumes: list[float] | None = None, wick: float = 0.3) -> Series:
    vols = volumes or [100.0] * len(closes)
    out: list[Candle] = []
    prev = closes[0]
    for i, (c, v) in enumerate(zip(closes, vols, strict=True)):
        out.append(Candle(i * TF_MS["1h"], prev, max(prev, c) + wick, min(prev, c) - wick, c, v))
        prev = c
    return Series.from_candles("TEST-USDT", "1h", out)


def hit(direction: str = "long", index: int = N - 1) -> PatternHit:
    d = "long" if direction == "long" else "short"
    return PatternHit("hammer", d, index, 0.0, 0.0, 0.0, index - 3, 0.0)


def zigzag(n: int = N) -> list[float]:
    """A steady rise with deep pullbacks (+0.6, -0.4): RSI near 60, above VWAP, Supertrend up."""
    out, p = [], 100.0
    for i in range(n):
        p += 0.6 if i % 2 else -0.4
        out.append(p)
    return out


def checks(s: Series, h: PatternHit, location: Location = "zone") -> dict[str, bool]:
    return {c.id: c.passed for c in checker(s, mirror(s))(h, location).checks}


def test_a_healthy_rise_at_a_zone_passes_location_rsi_vwap_supertrend() -> None:
    got = checks(series(zigzag()), hit())
    assert got["location"] and got["rsi"] and got["vwap"] and got["supertrend"]


def test_open_space_fails_location() -> None:
    assert not checks(series(zigzag()), hit(), "openSpace")["location"]


def test_rsi_above_70_is_overbought_and_fails() -> None:
    closes = [100 + 1.0 * i for i in range(N)]  # straight up: RSI near 100
    s = series(closes)
    cl = checker(s, mirror(s))(hit(), "zone")
    rsi_check = next(c for c in cl.checks if c.id == "rsi")
    assert not rsi_check.passed
    assert rsi_check.detail.startswith("overbought")


def test_volume_spike_needs_1_5x_the_average_before() -> None:
    vols = [100.0] * N
    vols[-1] = 160.0
    assert checks(series(zigzag(), vols), hit())["volume"]
    vols[-1] = 140.0
    assert not checks(series(zigzag(), vols), hit())["volume"]


def test_expanding_atr_passes_and_quiet_atr_fails() -> None:
    quiet_then_wild = series(zigzag(N - 10) + [110 + (3 if k % 2 else -3) for k in range(10)])
    assert checks(quiet_then_wild, hit())["atr"]
    wild_then_quiet = [100 + (3 if k % 2 else -3) for k in range(60)] + zigzag(N - 60)
    assert not checks(series(wild_then_quiet), hit())["atr"]


def test_bearish_setups_use_the_mirror() -> None:
    falling = series([300 - c for c in zigzag()])
    got = checks(falling, hit("short"))
    assert got["rsi"] and got["vwap"] and got["supertrend"]
    assert not checks(falling, hit("long"))["supertrend"]


def test_score_counts_the_passed_checks() -> None:
    s = series(zigzag())
    cl = checker(s, mirror(s))(hit(), "zone")
    assert cl.score == sum(c.passed for c in cl.checks)
    assert len(cl.checks) == MAX_SCORE == 6


def test_no_look_ahead() -> None:
    s = series(zigzag())
    h = hit(index=N - 30)
    full = checker(s, mirror(s))(h, "zone")
    cut = s.head(N - 29)
    assert checker(cut, mirror(cut))(h, "zone") == full


def test_supertrend_flips_with_the_trend_and_vwap_weights_volume() -> None:
    up_then_down = series(
        [100.0 + i for i in range(40)] + [140.0 - 2 * i for i in range(40)], wick=0.5
    )
    st = supertrend(up_then_down)
    assert st[35] == 1 and st[-1] == -1
    s = series([100.0] * 19 + [200.0], [1.0] * 19 + [19.0])
    assert rolling_vwap(s)[-1] > 130  # half the volume at a typical price ~167: (100 + 167) / 2
    assert np.isnan(rolling_vwap(s)[0])
