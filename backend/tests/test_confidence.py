"""Confidence checks (``confidence.py``, r9): order flow and CVD divergence, counted 0-3."""

from __future__ import annotations

from tcs.analysis.confidence import MAX_SCORE, SCORE_CONTEXTS, score_of
from tcs.analysis.flow import UNKNOWN, FlowContext


def test_order_flow_scores_against_neutral_agrees_as_0_1_2() -> None:
    assert score_of(FlowContext(-0.05, "against", False)).total == 0
    assert score_of(FlowContext(0.0, "neutral", False)).total == 1
    assert score_of(FlowContext(0.05, "confirms", False)).total == 2


def test_a_cvd_divergence_in_favour_adds_one() -> None:
    sc = score_of(FlowContext(0.05, "confirms", True))
    assert (sc.flow_not_against, sc.flow_agrees, sc.cvd_divergence) == (True, True, True)
    assert sc.total == MAX_SCORE == 3
    assert sc.context == "score:3"
    assert score_of(FlowContext(-0.05, "against", True)).total == 1


def test_unknown_flow_passes_no_check() -> None:
    assert score_of(UNKNOWN).total == 0


def test_every_score_has_a_statistics_context() -> None:
    assert SCORE_CONTEXTS == ("score:0", "score:1", "score:2", "score:3")
