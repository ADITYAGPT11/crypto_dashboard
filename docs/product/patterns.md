# Pattern, zone and order-block rules (rule set `2026.11-r5`)

The written rules behind `backend/src/tcs/analysis/`. Code and this page must agree; when they
don't, the code wins and this page is fixed in the same change. Any change to a threshold or rule
is a **new rule-set version** (`RULESET_VERSION`), measured from scratch.

## Rules every detector follows

| Rule                                                                             | How it is enforced                                                                                            |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Closed candles only; a hit confirms on candle _i_ using only candles ≤ _i_       | `tests/test_invariants.py::test_no_look_ahead` (each hit must reappear, identical, on the history cut at _i_) |
| Thresholds in ATR(14), never in price units                                      | `test_scale_invariant_and_deterministic` (prices × 1000 → same hits)                                          |
| Swings are used only once confirmed (3 candles each side, known 3 candles later) | `swings.py::Swing.known_at`; prefix test                                                                      |
| Bearish chart patterns are the bullish rule upside down                          | `common/series.py::mirror`; `test_bearish_patterns_are_mirrored_bullish_ones`                                 |
| Zones, order blocks and gaps exist from the close of the candle that formed them | `test_levels_known_when_formed`                                                                               |
| Every pattern in the catalogue can fire on real data                             | `test_every_pattern_in_the_catalogue_can_fire`                                                                |
| Any rule change shows up as a reviewed diff                                      | `tests/test_golden.py` on a year of real ETH 4h candles                                                       |

## Outcome and statistics (one rule for every setup)

- **Entry** = confirmation close. **Win** = target touched before stop within **30 candles**; a
  candle touching both counts as a **loss**; neither = expired; data ran out = open (not counted).
- **Costs** (since r4; `analysis/costs.py`), per case in R (percent of notional ÷ risk in
  percent, so tight stops pay more): taker **fee 0.05% a side** (Binance USDⓈ-M regular tier) +
  **slippage 0.025% a side** (`TCS_FEE_PCT`, `TCS_SLIPPAGE_PCT`), and the **funding actually
  paid** between entry (confirmation close) and exit (exit candle's close) from Binance's funding
  history (archive months + REST tail; longs pay a positive rate, shorts receive it). After the
  last known event the last rate is carried forward (estimated). Median cost: about 0.14 R a
  trade on 1h, 0.06 R on 4h, 0.03 R on 1d.
- **Win rate** with a **Wilson 95%** range; **break-even** after costs = L / (W + L), W = mean
  win in R minus its costs, L = 1 + mean cost of a loss (1.0 when wins lose after costs); the
  gross break-even 1 / (1 + average win in R) is kept alongside.
- **Expectancy** = mean R per resolved case after costs (gross alongside).
- **Verdict**: fewer than 30 resolved cases → too few; Wilson low above the break-even after
  costs → edge candidate; else no edge. In-sample.
- **Trailing take-profit** (second exit, since r3; `outcomes.py::evaluate_trailing`): the same
  entry and stop; when a candle touches the target the trade stays open and, from that candle's
  close, the stop follows the best price since entry by **0.5 ATR(14)**, only ever tightening.
  Exit where a candle trades through the stop (stop first, as above); after **120 candles**
  closed at the market. Profit = exit above entry (below for shorts). Statistics: every closed
  case counts; expectancy with a 95% range of the mean; verdict "edge" only when that range
  clears 0 R. After costs (wins = closed in profit after them). Chosen in a walk-forward study
  (below).
- **After the pattern** (the main view since r5; `outcomes.py::evaluate_ride`): from the
  confirmation close, price is followed with a **Supertrend (10, 3)** that starts at entry (band =
  hl2 ∓ 3 × ATR(10), moving only in the setup's favour) until the first close beyond the previous
  band, or 200 candles. No target, no tuning. Reported: share of rides that ended on the setup's
  side (Wilson range), average move % (95% range), median move, average best and worst point,
  candles, average move after costs. **Control**: the same ride from about 2 000 evenly spaced
  candles per coin and direction, weighted to the setup's coin mix. "Beats random" = at least 30
  rides and the whole 95% range of the average move above the control's average.
- **Setup** = pattern × direction × location × pattern timeframe × level timeframe. Pooled across
  the research coins; each coin also on its own; "any location" is the pattern's baseline.
  Pooled records are also split by order-flow context (below).

### Exit study (2026-11-18, 10 coins × 2 years, costs 0.15% per round trip)

Eleven exits on the same 45,425 setups, each also run on random entries with the same direction,
stop and target distance. Picked on year 1, checked on year 2.

| Group (net R per trade)        | Fixed 30 | Trailing TP 0.5 ATR | Random entry, trailing TP | Year 2 fixed / trailing |
| ------------------------------ | -------: | ------------------: | ------------------------: | ----------------------- |
| Chart patterns 1d              |   +0.155 |              +0.326 |                    +0.165 | +0.103 / +0.215         |
| Chart patterns 1d, momentum ok |   +0.330 |              +0.489 |                    +0.176 | +0.228 / +0.332         |
| Chart patterns 4h              |   −0.111 |              −0.012 |                    +0.030 | −0.175 / −0.103         |
| Chart patterns 1h              |   −0.091 |              +0.001 |                    −0.012 | −0.089 / +0.024         |
| Candlesticks (all)             |   −0.227 |              −0.142 |                    −0.105 | −0.229 / −0.133         |

The trailing exit roughly doubles the daily chart patterns' result and wins out of sample, but
random entries gain from it too: it improves the exit, not the pattern's edge over chance. It does
not make 1h, 4h or candlestick setups profitable after costs. The study scripts are not in the
repository yet (`ROADMAP.md → Parking lot`).

### Ride study (2026-11-20, 10 coins × 2 years, 44 907 setups)

Six trailing rides (Supertrend 10×2, 10×3, 20×3; close below EMA 20 / EMA 50; chandelier 22×3)
were run from every setup and from random candles. After chart patterns price ended on the
pattern's side 31–36% of the time against 35–38% for random candles, with average moves no
better than random; the ride that maximised year 1 fell apart on year 2 in every group (1d
Supertrend 20×3: +5.0% better than random in year 1, −4.1% in year 2). So the ride is not tuned:
the standard Supertrend (10, 3) is used and every figure is shown next to random candles. With
r5 on 1h, the bull flag (+0.38% vs −0.10%) and inverse H&S (+0.35% vs −0.11%) clear the bar
before costs; with about 90 setups per timeframe tested, treat them as leads to forward-test.

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

## Order-flow context (`analysis/flow.py`, since r2)

Measured for every setup at its confirmation candle, from Binance's per-candle taker (aggressive)
buy volume; delta = aggressive buys − aggressive sells. Context only: the statistics are split by
it so a setup can be compared with and without flow agreeing; it never creates a setup.

| Context          | Rule (longs; shorts use the mirrored series, where buyers and sellers swap)                         |
| ---------------- | --------------------------------------------------------------------------------------------------- |
| `delta:confirms` | Σ delta / Σ volume over the last 3 candles (confirmation included) ≥ +0.02                          |
| `delta:against`  | that ratio ≤ −0.02                                                                                  |
| `delta:neutral`  | in between                                                                                          |
| `cvdDiv:yes`     | the last 10 candles made a lower low than the 10 before, while CVD's low over the last 10 is higher |
| `cvdDiv:no`      | measurable, no divergence                                                                           |

The 0.02 cut comes from the feature's own spread (median |ratio| 0.023 on real ETH 4h), not from
outcomes. Unknown (no taker volume in the window) falls in no bucket. Context records are pooled
across coins only (per-coin buckets would be too small).

## Chart patterns (in-house)

| Pattern                          | Rule (bullish form; bearish twin by mirroring)                                                                                                                                                                                                                                                                                 | Plan                                                                          | Source                                      |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- | ------------------------------------------- |
| Double bottom / top              | Two swing lows 6–60 candles apart within 0.6 ATR, no lower low between, peak between ≥ 1.5 ATR above them; first close above that peak within 20 candles of the second low, once the low is confirmed                                                                                                                          | stop = lower low − 0.2 ATR; target = neckline + height                        | Bulkowski, _Encyclopedia of Chart Patterns_ |
| Inverse H&S / H&S                | Three swing lows 3–40 candles apart; head ≥ 0.5 ATR below both shoulders; shoulders within 1 ATR; neckline through the two peaks (may slope) ≥ 1.5 ATR above the head and 0.5 ATR above each shoulder; first close above the neckline within 25 candles of the right shoulder; a close below the right shoulder first fails it | stop = right shoulder − 0.2 ATR; target = neckline + head depth               | Edwards & Magee ch. 6                       |
| Bull / bear flag                 | Pole ≥ 3 ATR in 3–15 candles ending at a 15-candle high; pause of ≥ 3 candles giving back ≤ half the pole; first close above the pause's high within 20 candles                                                                                                                                                                | stop = pause low − 0.2 ATR; target = breakout + pole                          | Edwards & Magee ch. 11                      |
| Ascending / descending triangle  | Lines through the last 2–3 swing highs and lows (least squares, every swing within 0.4 ATR); upper line flat (moves ≤ 0.6 ATR over the formation), lower rising; 10–100 candles; height at start ≥ 2 ATR; end ≥ 25% narrower; closes inside (±0.25 ATR); first close beyond the upper line                                     | stop = last swing low − 0.2 ATR; target = breakout + height at start          | Edwards & Magee ch. 8                       |
| Symmetrical triangle (up / down) | As above with a falling upper and rising lower line; either breakout                                                                                                                                                                                                                                                           | as triangles                                                                  | Edwards & Magee ch. 8                       |
| Falling / rising wedge           | Both lines falling, the upper steeper (converging); breakout above the upper line                                                                                                                                                                                                                                              | stop as triangles; target = the wedge's start (highest high of the formation) | Edwards & Magee ch. 10; Bulkowski           |

A breakout against a pattern's textbook bias (e.g. an ascending triangle breaking down) is a
failed pattern, not a signal.

## Candlestick patterns (shape from TA-Lib)

TA-Lib (`CDLENGULFING`, `CDLHAMMER`, `CDLHANGINGMAN`, `CDLINVERTEDHAMMER`, `CDLSHOOTINGSTAR`,
`CDLMORNINGSTAR`, `CDLEVENINGSTAR`, `CDLHARAMI`) decides the shape and reports it on the pattern's
last candle. Our additions, the same for all:

- **Trend context** (Nison): the close before the pattern is below (bullish) / above (bearish) the
  close 5 candles earlier;
- **Size**: the pattern's range ≥ 0.8 ATR;
- **Plan**: stop 0.1 ATR beyond the pattern's extreme; target 1.5 R (break-even win rate 40%).

**Left out on purpose** (need session gaps; zero hits on a year of BTC 1h): piercing line, dark
cloud cover, kicking, abandoned baby. Three white soldiers / black crows fire about once a year
under TA-Lib's definition. Doji are indecision, not a direction.

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
