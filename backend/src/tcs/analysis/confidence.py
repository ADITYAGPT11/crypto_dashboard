"""Confidence checks (rule set r9): order-flow facts at confirmation, counted into a score 0-3.

The score feeds the confidence filter: the chart shows each setup's measured record at its
score (pattern, direction, timeframe, score; ``stats_job`` context ``score:<n>``), and a setup
**passes** only when that record clears break-even after costs (``stats.verdict_for`` = edge).
Setups that do not pass are drawn in grey. Nothing here is a weighted guess.

Chosen on the r8 trade plan with strict 5-minute fills (2026-11-22, 10 coins x 2 years, net R
after costs): candidates were picked on YEAR 1 only (|t| >= 2) and kept only when YEAR 2 agreed
(``docs/context/DECISIONS.md``). Kept: order flow (taker delta over the last 3 candles, ``flow.py``)
and CVD divergence. Dropped: Bitcoin's trend (flipped in year 2), daily trend (year 2 only),
EMA-200 trend, calm volume and RSI not stretched (the r7 checks; not consistent on profit).

- **flow_not_against**: the delta does not lean against the trade (neutral or confirms).
- **flow_agrees**: the delta leans the trade's way (``confirms``); together with the check above
  order flow scores 0 (against), 1 (neutral) or 2 (agrees).
- **cvd_divergence**: a CVD divergence in the trade's favour (sellers pushed price lower with
  less aggression; mirrored for shorts).

Unknown flow (no taker volume in the window) passes none of the checks.
"""

from __future__ import annotations

from dataclasses import dataclass

from tcs.analysis.flow import FlowContext

MAX_SCORE = 3

#: Statistics context of every score, in order (``score:0`` .. ``score:3``).
SCORE_CONTEXTS: tuple[str, ...] = tuple(f"score:{n}" for n in range(MAX_SCORE + 1))


@dataclass(frozen=True, slots=True)
class Score:
    flow_not_against: bool
    flow_agrees: bool
    cvd_divergence: bool

    @property
    def total(self) -> int:
        return sum((self.flow_not_against, self.flow_agrees, self.cvd_divergence))

    @property
    def context(self) -> str:
        return f"score:{self.total}"


def score_of(flow: FlowContext) -> Score:
    return Score(
        flow_not_against=flow.flow is not None and flow.flow != "against",
        flow_agrees=flow.flow == "confirms",
        cvd_divergence=flow.divergence is True,
    )
