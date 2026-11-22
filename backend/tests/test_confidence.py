"""Confidence checks (``confidence.py``): one fixture per check, mirrored twin, no look-ahead."""

from __future__ import annotations

import math

from tcs.analysis.confidence import RSI_STRETCHED, scorer
from tcs.analysis.flow import UNKNOWN, FlowContext
from tcs.analysis.types import PatternHit
from tcs.common.series import Candle, Series, mirror
from tcs.common.timeframes import TF_MS

N = 260


def series(closes: list[float], volumes: list[float] | None = None) -> Series:
    vols = volumes or [100.0] * len(closes)
    out: list[Candle] = []
    prev = closes[0]
    for i, (c, v) in enumerate(zip(closes, vols, strict=True)):
        out.append(Candle(i * TF_MS["1h"], prev, max(prev, c) + 0.2, min(prev, c) - 0.2, c, v))
        prev = c
    return Series.from_candles("TEST-USDT", "1h", out)


def hit(direction: str = "long", start: int = N - 4, index: int = N - 1) -> PatternHit:
    return PatternHit(
        pattern="hammer",
        direction="long" if direction == "long" else "short",
        index=index,
        entry=0.0,
        stop=0.0,
        target=0.0,
        start=start,
        extreme=0.0,
    )


def zigzag_up(n: int = N) -> list[float]:
    """A gentle rise with small pullbacks: above the EMA(200), RSI never stretched."""
    return [100 + 0.05 * i + (0.3 if i % 2 else 0.0) for i in range(n)]


CONFIRMS = FlowContext(0.05, "confirms", None)


def test_every_check_passes_in_a_calm_uptrend_with_flow() -> None:
    s = series(zigzag_up())
    sc = scorer(s, mirror(s))(hit(), CONFIRMS)
    assert (sc.with_trend, sc.flow_agrees, sc.calm_volume, sc.not_stretched) == (
        True,
        True,
        True,
        True,
    )
    assert sc.total == 4
    assert sc.context == "score:4"


def test_flow_must_confirm() -> None:
    s = series(zigzag_up())
    assert not scorer(s, None)(hit(), UNKNOWN).flow_agrees
    assert not scorer(s, None)(hit(), FlowContext(-0.05, "against", None)).flow_agrees


def test_below_the_ema_is_against_the_trend() -> None:
    s = series(list(reversed(zigzag_up())))
    assert not scorer(s, None)(hit(), CONFIRMS).with_trend


def test_a_volume_spike_in_the_pattern_is_not_calm() -> None:
    vols = [100.0] * N
    vols[N - 2] = 160.0  # 1.6x the mean of the 20 candles before the pattern
    s = series(zigzag_up(), vols)
    assert not scorer(s, None)(hit(), CONFIRMS).calm_volume
    vols[N - 2] = 140.0
    assert scorer(series(zigzag_up(), vols), None)(hit(), CONFIRMS).calm_volume


def test_a_spike_after_the_confirmation_is_not_seen() -> None:
    vols = [100.0] * N
    vols[N - 1] = 500.0  # the confirmation candle itself counts ...
    assert not scorer(series(zigzag_up(), vols), None)(hit(), CONFIRMS).calm_volume
    # ... a candle after it does not (no look-ahead)
    early = hit(start=N - 6, index=N - 3)
    assert scorer(series(zigzag_up(), vols), None)(early, CONFIRMS).calm_volume


def test_an_oversold_rsi_in_the_pattern_is_stretched() -> None:
    closes = zigzag_up()
    for k in range(12):  # a sharp drop into the pattern
        closes[N - 14 + k] = closes[N - 15] - 2.0 * (k + 1)
    s = series(closes)
    assert not scorer(s, None)(hit(), CONFIRMS).not_stretched
    assert RSI_STRETCHED == 35.0


def test_short_reads_the_mirror() -> None:
    s = series([-c + 400 for c in zigzag_up()])  # a gentle fall: the short twin of the rise
    sc = scorer(s, mirror(s))(hit("short"), CONFIRMS)
    assert sc.with_trend and sc.not_stretched and sc.total == 4


def test_short_without_mirror_is_an_error() -> None:
    s = series(zigzag_up())
    try:
        scorer(s, None)(hit("short"), CONFIRMS)
    except ValueError:
        return
    raise AssertionError("expected ValueError")


def test_needs_twenty_candles_before_the_pattern_for_volume() -> None:
    s = series(zigzag_up())
    assert not scorer(s, None)(hit(start=10, index=13), CONFIRMS).calm_volume
    assert math.isfinite(float(s.volume[0]))
