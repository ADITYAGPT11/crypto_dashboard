import type { Candle } from "../types/marketData";
import type { PatternHit, PatternType } from "../types/analysis";
import {
  bullishEngulfing,
  bullishHarami,
  hammer,
  invertedHammer,
  threeWhiteSoldiers,
  tweezersBottom,
  type OHLC,
} from "candlestick";
import { atr } from "./indicators";

/** Bars on each side that a swing low must be the lowest of. */
export const PIVOT_BARS = 3;
/** Target multiple of risk for single-candle patterns. */
export const CANDLE_PATTERN_R = 1.5;

export const PATTERN_LABELS: Record<PatternType, string> = {
  doubleBottom: "Double bottom",
  bullishEngulfing: "Bullish engulfing",
  hammer: "Hammer",
  invertedHammer: "Inverted hammer",
  bullishHarami: "Bullish harami",
  tweezersBottom: "Tweezer bottom",
  threeWhiteSoldiers: "Three white soldiers",
};

function isPivotLow(candles: Candle[], i: number, k: number): boolean {
  if (i - k < 0 || i + k >= candles.length) return false;
  const low = candles[i].low;
  for (let j = i - k; j <= i + k; j++) {
    if (j === i) continue;
    // Strict on the left, non-strict on the right: equal lows count once.
    if (j < i ? candles[j].low <= low : candles[j].low < low) return false;
  }
  return true;
}

/**
 * Double bottom: two swing lows within 0.6 ATR of each other, 6–60 candles
 * apart, with a neckline (highest high between them) at least 1.5 ATR above
 * the lows. Confirmed on the first close above the neckline within 20 candles
 * of the second low, and no earlier than PIVOT_BARS after it, so the second
 * low is a known swing low at confirmation time (no lookahead).
 *
 * Entry = confirmation close; stop = lower low − 0.2 ATR;
 * target = neckline + (neckline − lower low) (measured move).
 */
export function detectDoubleBottoms(candles: Candle[]): PatternHit[] {
  const atrs = atr(candles, 14);
  const pivots: number[] = [];
  for (let i = 0; i < candles.length; i++) if (isPivotLow(candles, i, PIVOT_BARS)) pivots.push(i);

  const hits: PatternHit[] = [];
  let lastConfirm = -1;
  for (let p = 1; p < pivots.length; p++) {
    const i2 = pivots[p];
    const a = atrs[i2];
    if (!Number.isFinite(a) || a <= 0) continue;

    for (let q = p - 1; q >= 0; q--) {
      const i1 = pivots[q];
      const gap = i2 - i1;
      if (gap < 6) continue;
      if (gap > 60) break;
      const low1 = candles[i1].low;
      const low2 = candles[i2].low;
      if (Math.abs(low1 - low2) > 0.6 * a) continue;

      const bottom = Math.min(low1, low2);
      let neckIdx = i1;
      let undercut = false;
      for (let j = i1; j <= i2; j++) {
        if (candles[j].high > candles[neckIdx].high) neckIdx = j;
        if (candles[j].low < bottom - 1e-12) undercut = true;
      }
      if (undercut) continue;
      const neckline = candles[neckIdx].high;
      if (neckline - Math.max(low1, low2) < 1.5 * a) continue;

      for (let c = i2 + PIVOT_BARS; c <= Math.min(i2 + 20, candles.length - 1); c++) {
        if (candles[c].close < bottom) break; // pattern failed before confirming
        if (candles[c].close > neckline) {
          if (c > lastConfirm) {
            const ac = Number.isFinite(atrs[c]) ? atrs[c] : a;
            hits.push({
              type: "doubleBottom",
              index: c,
              entry: candles[c].close,
              stop: bottom - 0.2 * ac,
              target: neckline + (neckline - bottom),
              low: bottom,
              neckline,
              points: [
                { index: i1, price: low1 },
                { index: neckIdx, price: neckline },
                { index: i2, price: low2 },
                { index: c, price: candles[c].close },
              ],
            });
            lastConfirm = c;
          }
          break;
        }
      }
      break; // use the nearest qualifying first low only
    }
  }
  return hits;
}

/**
 * Candlestick patterns from the `candlestick` package (MIT): it checks each
 * shape; we add the context it leaves out and the plan.
 *
 * - The package returns the index of a pattern's FIRST candle; the signal is
 *   its LAST candle, the moment the pattern is complete (no look-ahead).
 * - The pattern must span at least `minAtr` ATR, so dust candles don't count.
 * - Reversal patterns need a prior decline: the close before the pattern is
 *   below the close 5 candles earlier.
 * - Stop 0.1 ATR below the pattern low; target 1.5R.
 *
 * Piercing line and morning star are not used: both need price gaps, which a
 * 24/7 market almost never has.
 */
const CANDLE_RULES: {
  type: PatternType;
  find: (c: OHLC[]) => number[];
  size: number;
  reversal: boolean;
  minAtr: number;
}[] = [
  { type: "hammer", find: hammer, size: 1, reversal: true, minAtr: 0.8 },
  { type: "invertedHammer", find: invertedHammer, size: 1, reversal: true, minAtr: 0.8 },
  { type: "bullishEngulfing", find: bullishEngulfing, size: 2, reversal: true, minAtr: 0.8 },
  { type: "bullishHarami", find: bullishHarami, size: 2, reversal: true, minAtr: 0.8 },
  { type: "tweezersBottom", find: tweezersBottom, size: 2, reversal: true, minAtr: 0.8 },
  { type: "threeWhiteSoldiers", find: threeWhiteSoldiers, size: 3, reversal: false, minAtr: 1.5 },
];

export function detectCandlestickPatterns(candles: Candle[]): PatternHit[] {
  const atrs = atr(candles, 14);
  const hits: PatternHit[] = [];
  for (const rule of CANDLE_RULES) {
    for (const start of rule.find(candles)) {
      const end = start + rule.size - 1;
      const a = atrs[end];
      if (!Number.isFinite(a) || a <= 0) continue;
      const span = candles.slice(start, end + 1);
      const low = Math.min(...span.map((c) => c.low));
      const high = Math.max(...span.map((c) => c.high));
      if (high - low < rule.minAtr * a) continue;
      if (rule.reversal) {
        const before = start - 1;
        if (before < 5 || candles[before].close >= candles[before - 5].close) continue;
      }
      hits.push(candleHit(rule.type, end, candles[end].close, low, a));
    }
  }
  return hits;
}

function candleHit(
  type: PatternType,
  index: number,
  entry: number,
  low: number,
  a: number,
): PatternHit {
  const stop = low - 0.1 * a;
  return {
    type,
    index,
    entry,
    stop,
    target: entry + CANDLE_PATTERN_R * (entry - stop),
    low,
    points: [{ index, price: low }],
  };
}

export function detectAllPatterns(candles: Candle[]): PatternHit[] {
  return [...detectDoubleBottoms(candles), ...detectCandlestickPatterns(candles)].sort(
    (a, b) => a.index - b.index,
  );
}
