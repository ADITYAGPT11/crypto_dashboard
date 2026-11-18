"""Playbook (4h trigger -> 15m entry): each step, no look-ahead, the mirrored short twin, costs."""

from __future__ import annotations

import math

import numpy as np
import pytest

from tcs.analysis import playbook as pb
from tcs.analysis.playbook import Trigger, run_playbook
from tcs.analysis.playbook_stats import ClosedTrade, summarize_r
from tcs.analysis.types import PatternHit
from tcs.common.series import Series, mirror
from tcs.common.timeframes import TF_MS

from .helpers import candles, path, random_walk

LTF_PER_HTF = TF_MS["4h"] // TF_MS["15m"]


def htf_flat(n: int = 30) -> Series:
    """4h candles around 100 with a 10-point range (ATR 10: risk up to 10 is allowed)."""
    return candles([(100, 105, 95, 100)] * n, tf="4h")


def scenario() -> tuple[Series, Series, PatternHit]:
    """A long setup confirmed on 4h candle 20 (known at 15m bar 336), then on 15m: a dip to 97,
    a bounce to 99 (swing high), a lower low at 96, a rally through 99 (CHoCH), a pullback
    (higher low), a run to 108 and a fall to 90."""
    ltf = path(
        [
            (0, 100),
            (336, 100),
            (342, 97),
            (346, 99),
            (350, 96),
            (360, 103),
            (366, 100.5),
            (374, 106),
            (382, 104),
            (390, 108),
            (420, 90),
            (460, 90),
        ],
        tf="15m",
        wick=0.2,
    )
    hit = PatternHit("hammer", "long", 20, entry=100, stop=90, target=110, start=19, extreme=99)
    return htf_flat(), ltf, hit


def trade(t: Trigger, entry: str, exit: str) -> pb.Trade:
    return next(x for x in t.trades if x.entry_kind == entry and x.exit_kind == exit)


def test_trigger_needs_a_level() -> None:
    htf, ltf, hit = scenario()
    assert run_playbook(htf, ltf, [(hit, "openSpace")]) == []
    assert len(run_playbook(htf, ltf, [(hit, "orderBlock")])) == 1


def test_choch_impulse_and_stop() -> None:
    htf, ltf, hit = scenario()
    (t,) = run_playbook(htf, ltf, [(hit, "zone")])
    assert t.stage == "confirmed"
    assert t.start == 21 * LTF_PER_HTF
    j = t.choch_index
    assert j is not None and t.broke is not None
    # The CHoCH is the first close above the swing high near 99, after the lower low at 96.
    assert t.broke == pytest.approx(99.2)
    assert float(ltf.close[j - 1]) <= t.broke < float(ltf.close[j])
    assert t.impulse_low == pytest.approx(95.8)
    m = trade(t, "market", "trail")
    assert m.entry == pytest.approx(float(ltf.close[j]))
    a = float(pb.atr(ltf)[j])
    assert m.stop == pytest.approx(95.8 - pb.STOP_ATR * a)
    # Fib entry: 0.618 back into the impulse, below the CHoCH close.
    f = trade(t, "fib", "trail")
    hi = t.impulse_high
    assert hi is not None
    assert f.entry == pytest.approx(hi - pb.FIB_LEVEL * (hi - 95.8))


def test_exits_trail_target_and_costs() -> None:
    htf, ltf, hit = scenario()
    (t,) = run_playbook(htf, ltf, [(hit, "zone")])
    trail = trade(t, "market", "trail")
    assert trail.status == "closed" and trail.reason == "trail"
    assert trail.stop_now > trail.entry  # trailed under the higher low near 104
    assert trail.r_net > 0
    # Target 110 is never reached: the fall to 90 hits the original stop.
    tgt = trade(t, "market", "target")
    assert tgt.status == "closed" and tgt.reason == "stop"
    assert tgt.r_gross == pytest.approx(-1)
    # Market in and stopped out: taker + slippage both ways, in R.
    costs = (pb.TAKER + pb.SLIPPAGE) * (tgt.entry + tgt.stop) / tgt.risk
    assert tgt.r_net == pytest.approx(-1 - costs)
    assert tgt.r_net < -1
    managed = trade(t, "market", "managed")
    assert managed.status == "closed" and managed.reason in ("trail", "breakeven")
    assert managed.r_net > -0.1


def test_costs_are_charged_on_shorts_too() -> None:
    """Shorts run on the mirrored series (negative prices): costs must still reduce R."""
    htf, ltf, hit = scenario()
    short = PatternHit(
        "hangingMan",
        "short",
        hit.index,
        -hit.entry,
        -hit.stop,
        -hit.target,
        hit.start,
        -hit.extreme,
    )
    m_htf, m_ltf = mirror(htf), mirror(ltf)
    (t,) = run_playbook(m_htf, m_ltf, [(short, "zone")])
    tgt = trade(t, "market", "target")
    assert tgt.status == "closed" and tgt.reason == "stop"
    assert tgt.r_gross == pytest.approx(-1)
    costs = (pb.TAKER + pb.SLIPPAGE) * (abs(tgt.entry) + abs(tgt.stop)) / abs(tgt.risk)
    assert tgt.r_net == pytest.approx(-1 - costs)
    assert tgt.r_net < -1


def test_invalidated_when_price_closes_below_the_setup_stop() -> None:
    htf = htf_flat()
    ltf = path([(0, 100), (176, 100), (180, 85), (300, 85)], tf="15m", wick=0.2)
    hit = PatternHit("hammer", "long", 10, entry=100, stop=90, target=110, start=9, extreme=99)
    (t,) = run_playbook(htf, ltf, [(hit, "zone")])
    assert t.stage == "invalidated" and t.trades == ()


def test_expires_without_a_choch_and_waits_at_the_data_edge() -> None:
    htf = htf_flat()
    flat = path([(0, 100), (400, 100)], tf="15m", wick=0.2)
    hit = PatternHit("hammer", "long", 10, entry=100, stop=90, target=110, start=9, extreme=99)
    (t,) = run_playbook(htf, flat, [(hit, "zone")])
    assert t.stage == "expired"
    (w,) = run_playbook(htf, flat.head(11 * LTF_PER_HTF + 5), [(hit, "zone")])
    assert w.stage == "waiting"


# Properties on random walks ---------------------------------------------------------------


def aggregate(ltf: Series) -> Series:
    """4h candles made from 15m ones (16 per candle)."""
    n = len(ltf) // LTF_PER_HTF
    rows = []
    for i in range(n):
        s = slice(i * LTF_PER_HTF, (i + 1) * LTF_PER_HTF)
        rows.append(
            (
                float(ltf.open[s.start]),
                float(np.max(ltf.high[s])),
                float(np.min(ltf.low[s])),
                float(ltf.close[s.stop - 1]),
            )
        )
    return candles(rows, tf="4h")


def walk_setups(seed: int) -> tuple[Series, Series, list[tuple[PatternHit, str]]]:
    raw = random_walk(seed, n=4000, tf="15m")
    ltf = Series(
        raw.symbol,
        "15m",
        np.arange(len(raw), dtype=np.int64) * TF_MS["15m"],
        raw.open,
        raw.high,
        raw.low,
        raw.close,
        raw.volume,
        raw.taker_buy,
    )
    htf = aggregate(ltf)
    rng = np.random.default_rng(seed)
    setups: list[tuple[PatternHit, str]] = []
    for i in rng.choice(np.arange(20, len(htf) - 10), 25, replace=False):
        i = int(i)
        c = float(htf.close[i])
        a = abs(float(htf.high[i] - htf.low[i])) or 1.0
        if rng.random() < 0.5:
            h = PatternHit("hammer", "long", i, c, c - 2 * a, c + 3 * a, i - 1, c - a)
        else:
            h = PatternHit("hangingMan", "short", i, c, c + 2 * a, c - 3 * a, i - 1, c + a)
        setups.append((h, "zone"))
    return htf, ltf, setups


@pytest.mark.parametrize("seed", [1, 2, 3])
def test_no_look_ahead(seed: int) -> None:
    htf, ltf, setups = walk_setups(seed)
    triggers = run_playbook(htf, ltf, setups)  # type: ignore[arg-type]
    checked = 0
    for t in triggers:
        if t.choch_index is None:
            continue
        # Cut the LTF right after the CHoCH candle: the same CHoCH, impulse and market entry.
        (cut,) = run_playbook(htf, ltf.head(t.choch_index + 1), [(t.hit, "zone")])
        assert cut.choch_index == t.choch_index
        assert cut.impulse_low == t.impulse_low
        assert trade(cut, "market", "trail").entry == trade(t, "market", "trail").entry
        # A closed trade is decided by the candles up to its exit.
        for tr in t.trades:
            if tr.status == "closed" and tr.exit_index is not None:
                (again,) = run_playbook(htf, ltf.head(tr.exit_index + 1), [(t.hit, "zone")])
                same = trade(again, tr.entry_kind, tr.exit_kind)
                assert (same.status, same.exit_index, same.r_net) == (
                    "closed",
                    tr.exit_index,
                    pytest.approx(tr.r_net),
                )
                checked += 1
    assert checked > 0


@pytest.mark.parametrize("seed", [4, 5])
def test_short_is_the_long_rule_on_the_mirrored_series(seed: int) -> None:
    htf, ltf, setups = walk_setups(seed)
    shorts = [(h, loc) for h, loc in setups if h.direction == "short"]
    as_long = [
        (
            PatternHit(
                h.pattern, "long", h.index, -h.entry, -h.stop, -h.target, h.start, -h.extreme
            ),
            loc,
        )
        for h, loc in shorts
    ]
    got = run_playbook(htf, ltf, shorts)  # type: ignore[arg-type]
    ref = run_playbook(mirror(htf), mirror(ltf), as_long)  # type: ignore[arg-type]
    assert [t.stage for t in got] == [t.stage for t in ref]
    for a, b in zip(got, ref, strict=True):
        assert a.choch_index == b.choch_index
        for x, y in zip(a.trades, b.trades, strict=True):
            assert x.status == y.status
            assert x.r_net == pytest.approx(y.r_net)
            if math.isfinite(x.entry):
                assert x.entry == pytest.approx(-y.entry)


def test_deterministic_and_scale_invariant() -> None:
    htf, ltf, setups = walk_setups(6)
    a = run_playbook(htf, ltf, setups)  # type: ignore[arg-type]
    b = run_playbook(htf, ltf, setups)  # type: ignore[arg-type]
    assert repr(a) == repr(b)  # repr: skipped trades hold NaN prices, and NaN != NaN
    scaled = [
        (
            PatternHit(
                h.pattern,
                h.direction,
                h.index,
                h.entry * 1000,
                h.stop * 1000,
                h.target * 1000,
                h.start,
                h.extreme * 1000,
            ),
            loc,
        )
        for h, loc in setups
    ]
    c = run_playbook(htf.scaled(1000), ltf.scaled(1000), scaled)  # type: ignore[arg-type]
    for x, y in zip(a, c, strict=True):
        assert x.stage == y.stage
        for p, q in zip(x.trades, y.trades, strict=True):
            assert p.status == q.status
            assert p.r_net == pytest.approx(q.r_net, abs=1e-9)


# Records ------------------------------------------------------------------------------------


def test_summary_needs_mean_r_and_beating_random_for_an_edge() -> None:
    good = [ClosedTrade(1.0 if i % 2 else -0.5, 1.1, -0.2, 10) for i in range(60)]
    s = summarize_r(good)
    assert s.n == 60 and s.win_rate == 0.5
    assert s.mean_r == pytest.approx(0.25)
    assert s.mean_r_low > 0 and s.edge_vs_random_low > 0
    assert s.verdict == "edge"
    assert s.profit_factor == pytest.approx(30 / 15)
    same_as_random = [ClosedTrade(1.0 if i % 2 else -0.5, 1.1, 0.25, 10) for i in range(60)]
    assert summarize_r(same_as_random).verdict == "noEdge"
    assert summarize_r(good[:10]).verdict == "tooFew"
    assert summarize_r([]).n == 0
