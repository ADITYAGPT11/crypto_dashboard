import type { Candle } from "../types/marketData";
import type { PatternHit, PatternType } from "../types/analysis";
import { atr } from "./indicators";

/** Bars on each side that a swing low must be the lowest of. */
export const PIVOT_BARS = 3;
/** Target multiple of risk for single-candle patterns. */
export const CANDLE_PATTERN_R = 1.5;

export const PATTERN_LABELS: Record<PatternType, string> = {
  doubleBottom: "Double bottom",
  bullishEngulfing: "Bullish engulfing",
  hammer: "Hammer",
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
 * Bullish engulfing: a bearish candle (body ≥ 0.2 ATR) followed by a bullish
 * candle whose body fully covers it. Stop below both lows; target 1.5R.
 */
export function detectBullishEngulfing(candles: Candle[]): PatternHit[] {
  const atrs = atr(candles, 14);
  const hits: PatternHit[] = [];
  for (let i = 1; i < candles.length; i++) {
    const a = atrs[i];
    if (!Number.isFinite(a) || a <= 0) continue;
    const prev = candles[i - 1];
    const cur = candles[i];
    const prevBody = prev.open - prev.close;
    const curBody = cur.close - cur.open;
    if (prevBody < 0.2 * a || curBody <= prevBody) continue;
    if (cur.open > prev.close || cur.close < prev.open) continue;
    const low = Math.min(prev.low, cur.low);
    hits.push(candleHit("bullishEngulfing", i, cur.close, low, a));
  }
  return hits;
}

/**
 * Hammer after a decline: range ≥ 0.8 ATR, lower wick ≥ 2× body, upper wick
 * ≤ 25% of range, and close below the close 5 candles earlier. Stop below the
 * low; target 1.5R.
 */
export function detectHammers(candles: Candle[]): PatternHit[] {
  const atrs = atr(candles, 14);
  const hits: PatternHit[] = [];
  for (let i = 5; i < candles.length; i++) {
    const a = atrs[i];
    if (!Number.isFinite(a) || a <= 0) continue;
    const c = candles[i];
    const range = c.high - c.low;
    const body = Math.abs(c.close - c.open);
    const lowerWick = Math.min(c.open, c.close) - c.low;
    const upperWick = c.high - Math.max(c.open, c.close);
    if (range < 0.8 * a || body <= 0) continue;
    if (lowerWick < 2 * body || upperWick > 0.25 * range) continue;
    if (c.close >= candles[i - 5].close) continue;
    hits.push(candleHit("hammer", i, c.close, c.low, a));
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
  return [
    ...detectDoubleBottoms(candles),
    ...detectBullishEngulfing(candles),
    ...detectHammers(candles),
  ].sort((a, b) => a.index - b.index);
}
