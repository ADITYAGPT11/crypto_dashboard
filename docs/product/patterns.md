# Pattern, zone and order-block rules (rule set `2026.11-r12`)

The written rules behind `backend/src/tcs/analysis/`. Code and this page must agree; when they
don't, the code wins and this page is fixed in the same change. Any change to a threshold or rule
is a **new rule-set version** (`RULESET_VERSION`), measured from scratch.

## Rules every detector follows

| Rule                                                                                                 | How it is enforced                                                                                            |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Closed candles only; a hit confirms on candle _i_ using only candles ≤ _i_                           | `tests/test_invariants.py::test_no_look_ahead` (each hit must reappear, identical, on the history cut at _i_) |
| Thresholds in ATR(14), never in price units                                                          | `test_scale_invariant_and_deterministic` (prices × 1000 → same hits)                                          |
| Swings are used only once confirmed (3 candles each side, known 3 candles later)                     | `swings.py::Swing.known_at`; prefix test                                                                      |
| Bearish patterns (chart and candlestick) are the bullish rule upside down                            | `common/series.py::mirror`; `test_bearish_patterns_are_mirrored_bullish_ones`, `test_candlesticks.py`         |
| Every detection's invalidation price is behind and its measured move ahead of the confirmation close | `test_plan_is_ordered_stop_entry_target` (internal: not shown in the app since r10)                           |
| Zones, order blocks and gaps exist from the close of the candle that formed them                     | `test_levels_known_when_formed`                                                                               |
| Every pattern in the catalogue can fire on real data                                                 | `test_every_pattern_in_the_catalogue_can_fire`                                                                |
| Any rule change shows up as a reviewed diff                                                          | `tests/test_golden.py` on a year of real ETH 4h candles                                                       |

## Setup checklist (`analysis/checklist.py`, since r10)

Every pattern gets six yes/no checks read at its **confirmation candle** (only candles up to it),
shown as "4/6 checks" in the pattern rows under the chart (chart labels carry the name only), the Dashboard scanner and alerts. It
describes the context the pattern formed in. It is **not** a probability and has not been
measured against outcomes (the owner removed the trade plan and all win-rate statistics on
2026-11-22, `DECISIONS.md`). Bullish form; bearish setups use the mirror.

| Check      | Passes when                                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------------- |
| Location   | the pattern formed at an intact bullish order block or demand zone (`location.py`, below)               |
| RSI        | RSI(14) between 50 and 70 (shorts 30–50); above 70 (below 30) fails and is marked overbought (oversold) |
| Volume     | the confirmation candle traded ≥ 1.5× the mean volume of the 20 candles before it                       |
| VWAP       | the confirmation close is above the rolling VWAP(20) (below for shorts)                                 |
| ATR        | ATR(14) is at or above its own 50-candle mean (volatility expanding)                                    |
| Supertrend | Supertrend(10, 3) points up (down for shorts)                                                           |

VWAP is rolling over 20 candles (typical price × volume) rather than session-anchored, so it means
the same on every timeframe. Supertrend: bands at hl2 ± 3 × ATR(10) that only tighten while price
stays on their side; the trend flips when a close crosses the opposite band.

## Location

A level counts when it was **known before the pattern's first candle** and **still intact at
confirmation**, its side matches the trade (demand / bullish block for longs; supply / bearish
block for shorts), and the pattern's extreme (low for longs, high for shorts) is inside it ±0.25 ATR.
Levels can come from a higher timeframe; matching is by time.

| Location     | Meaning                                            |
| ------------ | -------------------------------------------------- |
| `confluence` | at a zone and an order block                       |
| `zone`       | at a demand (long) or supply (short) zone          |
| `orderBlock` | at a bullish (long) or bearish (short) order block |
| `openSpace`  | neither                                            |

## Chart patterns (in-house)

The "Plan" columns below are each detector's internal invalidation price and measured move. They
keep the detectors honest in the invariant tests and are not shown in the app (no trade plan since
r10).

| Pattern                          | Rule (bullish form; bearish twin by mirroring)                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Plan                                                                          | Source                                      |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------- |
| Double bottom / top              | **Prior downtrend**: the first low ≥ 2 ATR below the close 20 candles before it. Two swing lows 6–60 candles apart within 0.6 ATR, no lower low between, peak (highest high strictly between the two lows' candles, never a low's own wick; r11) ≥ 1.5 ATR above them; first close above that peak within 20 candles of the second low, once the low is confirmed; no signal when that close is already past the target                                                                                           | stop = lower low − 0.2 ATR; target = neckline + height                        | Bulkowski, _Encyclopedia of Chart Patterns_ |
| Inverse H&S / H&S                | **Prior downtrend** into the left shoulder (as double bottom). Three swing lows 3–40 candles apart, neither side (shoulder to head) more than twice as long as the other (r12); head ≥ 0.5 ATR below both shoulders; shoulders within 1 ATR; neckline through the two peaks (may slope) ≥ 1.5 ATR above the head and 0.5 ATR above each shoulder; first close above the neckline within 25 candles of the right shoulder; a close below the right shoulder first fails it; no signal when already past the target | stop = right shoulder − 0.2 ATR; target = neckline + head depth               | Edwards & Magee ch. 6                       |
| Bull / bear flag                 | Pole ≥ 3 ATR in 3–15 candles ending at a 15-candle high; pause of ≥ 3 candles giving back ≤ half the pole and drifting **sideways or against the pole** (least-squares slope of its closes ≤ 0); first close above the pause's high within 20 candles                                                                                                                                                                                                                                                             | stop = pause low − 0.2 ATR; target = breakout + pole                          | Edwards & Magee ch. 11                      |
| Ascending / descending triangle  | Lines through the last 2–3 swing highs and lows, at least 5 in all (3 + 2 or 3 + 3, Bulkowski's minimum touches; r11) (least squares, every swing within 0.4 ATR); upper line flat (moves ≤ 0.6 ATR over the formation), lower rising; 10–100 candles; height at start ≥ 2 ATR; end ≥ 25% narrower; breakout at most 75% of the way from the start to the apex (r12); closes inside (±0.25 ATR); first close beyond either line                                                                                   | stop = last swing low − 0.2 ATR; target = breakout + height at start          | Edwards & Magee ch. 8                       |
| Symmetrical triangle (up / down) | As above with a falling upper and rising lower line; either breakout                                                                                                                                                                                                                                                                                                                                                                                                                                              | as triangles                                                                  | Edwards & Magee ch. 8                       |
| Falling / rising wedge           | Both lines falling, the upper steeper (converging); apex rule as triangles; breakout above the upper line (or below the lower: against the bias)                                                                                                                                                                                                                                                                                                                                                                  | stop as triangles; target = the wedge's start (highest high of the formation) | Edwards & Magee ch. 10; Bulkowski           |

A breakout against a pattern's usual direction (an ascending triangle or falling wedge breaking
down, a descending triangle or rising wedge breaking up) is a signal in the breakout's direction,
as Bulkowski counts it (r12; a failed pattern with no signal until r11). The wedge's measured move
then is the height at the start, like a triangle's. Triangles and wedges need no prior trend
(they continue or reverse); flags have their pole.

**Volume while it formed** (r12, information only): for flags (the pause) and triangles and
wedges (start to breakout) the app shows "VOL↓" when the least-squares slope of volume over the
formation is negative (`checklist.formation_volume`). Textbooks expect falling volume (Bulkowski:
about three times in four); it is not one of the six checks and never changes the score.

## Candlestick patterns (in-house since r5)

Written in `analysis/candlesticks.py` to Nison (_Japanese Candlestick Charting Techniques_) and
StockCharts ChartSchool; the bullish rule once, the bearish twin on the mirrored series (upside
down a hammer is a shooting star and an inverted hammer a hanging man). TA-Lib's `CDL*` functions
were used until r4 and dropped (`DECISIONS.md` 2026-11-21): four of them demand a gap between
candle bodies that a 24/7 market never has (on a year of BTC, ETH and SOL every hit had a "gap" of
under 0.05 ATR, a one-tick difference), and their hammer family accepts a shadow just longer than
the body.

| Pattern (bullish / bearish twin) | Shape                                                                                                                                                                                         |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bullish / bearish engulfing      | A down candle that is not a doji, then an up candle whose body covers its body (one end may be equal)                                                                                         |
| Hammer / shooting star           | Lower shadow ≥ 2 × the body; upper shadow ≤ 10% of the range                                                                                                                                  |
| Inverted hammer / hanging man    | Upper shadow ≥ 2 × the body; lower shadow ≤ 10% of the range; no gap required (StockCharts: "the essence of the reversal should not be lost without the gap")                                 |
| Morning / evening star           | A long down candle; a short-bodied star whose body lies wholly below the first body (touching allowed: the 24/7 form of the gap); a long up candle closing above the middle of the first body |
| Bullish / bearish harami         | A long down candle, then a short body inside its body                                                                                                                                         |

"Long" / "short" body = above / at most the mean body of the 10 candles before (TA-Lib's default
candle settings, the common quantification); doji = body ≤ 10% of the range.

The same for every pattern:

- **Trend**: the hammer family only (r12). A hammer and a hanging man are the same candle (as are
  an inverted hammer and a shooting star), named by the trend before it, so a hammer or inverted
  hammer needs the close before it below EMA(20) and ≥ 0.5 ATR below the close 5 candles earlier;
  the mirror gives the hanging man and shooting star the same rise. Engulfing, stars and harami
  have no trend filter (since r6: it did not raise the then-measured win rate on 2 years × 10
  coins and kept only a third of the cases; `DECISIONS.md`, 2026-11-22).
- **Size**: the pattern's range ≥ 0.8 ATR ("large relative to the last 10–20 days").
- **Confirmation** (Nison; Bulkowski's breakout): within 3 candles a close above the pattern's
  high; a close below its low first cancels it. The morning / evening star confirms itself on
  its third candle (StockCharts: no further confirmation needed).
- **Plan** (internal, not shown since r10): entry at the confirmation close; stop 0.1 ATR beyond the pattern's extreme; target
  1.5 R.

**Left out on purpose**: piercing line, dark cloud cover, kicking, abandoned baby (their gaps are
the pattern), three white soldiers / black crows (about once a year), doji (indecision, not a
direction).

## Demand and supply zones (base and departure, after Seiden)

- **Base**: 1–4 consecutive candles with body ≤ 50% of their range.
- **Departure**: the next candle's range ≥ 1.5 ATR, body ≥ 60% of range, closing beyond the base.
- **Demand**: proximal = highest body top of the base; distal = lowest low of base and departure.
  Supply mirrors it. Minimum height 0.25 ATR.
- Known when the departure closes. **Test** = price trades back in; **held** = closes back out on
  the original side; **broken** = close through the distal edge. "Fresh" = never tested.

## Market structure, order blocks, fair value gaps (ICT / SMC)

- **Break of structure**: first close beyond the latest known, unbroken swing high (low). In the
  trend's direction = **BOS**; first against it = **CHoCH**.
- **Order block**: the last opposite candle at or up to 5 candles before the lowest low (highest
  high) between the broken swing and the break: the displacement's origin. Full candle range.
  Known at the break's close; mitigated on the first trade back in; ends on a close through it.
- **Fair value gap**: candle 1's high below candle 3's low (bullish), at least 0.1 ATR; known when
  candle 3 closes; filled when price trades through it. Shown on the chart; not a location.

## Order-book liquidity (browser, observation only)

Full books of Binance USDⓈ-M (REST snapshot + diff stream, Binance's documented sync) and OKX
perpetuals (`books` channel, sequence-checked) are summed and bucketed into about 120 round price
steps across the range the books cover, sampled every 2 s since the page opened. The heatmap shows
the average resting size per chart bar; the pools table lists the largest buckets per side, a
**wall** being ≥ 3× the side's median bucket. Visible orders can be pulled or spoofed and their
owners are unknown, so liquidity is **not** used in any statistic.
