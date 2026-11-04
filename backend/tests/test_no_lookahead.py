"""An event on candle t must be identical whether or not later candles exist.

ta_patterns ships its own check at 4 cut points; ours runs our whole pipeline (detectors,
run-start events, ATR, entry/stop/target) on gapless crypto-style data at many cuts.
"""

import numpy as np

from tcs.research.patterns.service import analyze
from tests.synthetic import crypto_candles, prefix


def test_events_do_not_change_when_future_candles_arrive() -> None:
    full_c = crypto_candles(seed=7, n=420)
    full = analyze(full_c, ("chart", "candlestick"))
    assert len(full.events) > 100, "fixture must produce events or the test is vacuous"
    for cut in range(250, 421, 17):
        part = analyze(prefix(full_c, cut), ("chart", "candlestick"))
        on_full = {e for e in full.events if e.index < cut}
        assert set(part.events) == on_full, f"events differ at cut {cut}"
        assert np.allclose(part.atr[:cut], full.atr[:cut], equal_nan=True)
