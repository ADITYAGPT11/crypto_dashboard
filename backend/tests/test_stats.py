import pytest

from tcs.research.patterns.outcome import Outcome
from tcs.research.patterns.stats import MIN_SAMPLE, summarize, verdict_for, wilson


def test_wilson_known_value() -> None:
    lo, hi = wilson(5, 10)
    assert lo == pytest.approx(0.2366, abs=1e-4) and hi == pytest.approx(0.7634, abs=1e-4)
    assert wilson(0, 0) == (0.0, 1.0)


def test_verdict() -> None:
    assert verdict_for(MIN_SAMPLE - 1, 0.9, 0.3) == "tooFew"
    assert verdict_for(MIN_SAMPLE, 0.34, 1 / 3) == "edge"
    assert verdict_for(MIN_SAMPLE, 0.30, 1 / 3) == "noEdge"


def _o(result: str, r: float, pct: float) -> Outcome:
    return Outcome(100, 99, 102, 1, result, None, 3, r, pct, {5: pct, 10: None, 20: None})  # type: ignore[arg-type]


def test_summarize_counts_only_wins_and_losses_in_n() -> None:
    s = summarize([_o("win", 2, 2), _o("loss", -1, -1), _o("expired", 0, 0), _o("open", 0, 0)])
    assert (s.n, s.wins, s.losses, s.expired, s.open) == (2, 1, 1, 1, 1)
    assert s.win_rate == 0.5 and s.break_even == pytest.approx(1 / 3)
    assert s.expectancy_r == pytest.approx(0.5)
    assert s.forward[0].n == 4 and s.forward[1].n == 0


def test_multiple_testing_correction_is_stricter_and_drives_the_verdict() -> None:
    from tcs.research.patterns.stats import adjusted_z

    assert adjusted_z(1) == pytest.approx(1.96, abs=1e-3) and adjusted_z(100) > 3.4
    # 60% of 200 at a 1:1 bracket clears break-even alone, not after 150 tests.
    rows = [_o("win", 1, 1)] * 120 + [_o("loss", -1, -1)] * 80
    assert summarize(rows, tests=1).verdict == "edge"
    many = summarize(rows, tests=150)
    assert many.verdict == "noEdge" and many.ci_low_adjusted < many.ci_low
