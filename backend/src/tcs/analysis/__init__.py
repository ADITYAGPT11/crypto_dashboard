"""The rule set: detectors, locations, outcomes and statistics.

Every detector follows the same contract:

- input is a ``Series`` of CLOSED candles;
- a hit is confirmed on candle ``index`` using only candles ``<= index``
  (``tests/test_invariants.py`` checks this on every detector);
- thresholds are expressed in ATR, so results do not depend on the price scale;
- parameters live in named constants next to the detector and are part of
  ``RULESET_VERSION`` (changing one is a new version, measured separately).
"""
