/**
 * Pure technical indicators over plain numbers.
 *
 * Convention: every function returns a fixed-length array aligned to the
 * input (warm-up slots where insufficient data exists → NaN), so callers can
 * index rows by candle position without offset math. All inputs/outputs are
 * plain numbers — no exchange types, no UI types (unit-testable).
 *
 * Rationale (OPEN_SOURCE_REUSE.md): bennycode/trading-signals has no LICENSE,
 * so the math is implemented in-project as pure, unit-tested functions.
 */

export interface CandleLike {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** length-preserving helper */
function aligned<T>(len: number, fill: (i: number) => T): T[] {
  return Array.from({ length: len }, (_, i) => fill(i));
}

const nan = Number.NaN;

// ---------------------------------------------------------------------------
// Moving averages
// ---------------------------------------------------------------------------

/** Simple moving average; warm-up slots (first period−1) are NaN. O(n·p). */
export function sma(values: number[], period: number): number[] {
  return aligned(values.length, (i) => {
    if (i < period - 1) return nan;
    let sum = 0;
    for (let k = i - period + 1; k <= i; k++) sum += values[k];
    return sum / period;
  });
}

/**
 * Exponential moving average (α = 2/(period+1)). The SMA of the first
 * `period` values seeds the series; earlier slots are NaN. Iterative.
 */
export function ema(values: number[], period: number): number[] {
  return emaSeries(values, period);
}

/**
 * Plain EMA array; iterative (avoids deep recursion on 1000-candle buffers).
 */
function emaSeries(values: number[], period: number): number[] {
  const out = aligned(values.length, () => nan);
  const alpha = 2 / (period + 1);
  let emaPrev = nan;
  for (let i = period - 1; i < values.length; i++) {
    if (!Number.isFinite(emaPrev)) {
      let sum = 0;
      for (let k = 0; k <= i; k++) sum += values[k];
      emaPrev = sum / period;
    } else {
      emaPrev = alpha * values[i] + (1 - alpha) * emaPrev;
    }
    out[i] = emaPrev;
  }
  return out;
}

// ---------------------------------------------------------------------------
// RSI (Wilder's smoothing) — single-pass, iterative
// ---------------------------------------------------------------------------

/**
 * Relative Strength Index in [0, 100]; valid from index `period` onward.
 * First `period` slots are NaN. When avgLoss is 0 the RSI is 100, and 50 is
 * reported for a flat middle section.
 */
export function rsi(closes: number[], period = 14): number[] {
  const out = aligned(closes.length, () => nan);
  if (closes.length <= period) return out;

  let gainSum = 0;
  let lossSum = 0;
  for (let k = 1; k <= period; k++) {
    const diff = closes[k] - closes[k - 1];
    if (diff >= 0) gainSum += diff;
    else lossSum -= diff;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  out[period] = wilderRsi(avgGain, avgLoss);

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = wilderRsi(avgGain, avgLoss);
  }
  return out;
}

function wilderRsi(avgGain: number, avgLoss: number): number {
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

// ---------------------------------------------------------------------------
// MACD
// ---------------------------------------------------------------------------

export interface MacdPoint {
  macd: number;
  signal: number;
  histogram: number;
}

/**
 * MACD: line = EMA(fast) − EMA(slow); signal = EMA(signal) of the line seeded
 * on its first valid value; histogram = line − signal. Slots before index
 * `slow + signal − 2` are NaN.
 */
export function macd(values: number[], fast = 12, slow = 26, signal = 9): MacdPoint[] {
  const fastEma = emaSeries(values, fast);
  const slowEma = emaSeries(values, slow);
  const macdLine = aligned(values.length, (i) => fastEma[i] - slowEma[i]);

  const out = aligned(
    values.length,
    () => ({ macd: nan, signal: nan, histogram: nan }) as MacdPoint,
  );
  const alpha = 2 / (signal + 1);
  const firstValid = slow - 1;
  const signalValidFrom = firstValid + signal - 1;

  let sig = nan;
  for (let i = firstValid; i < values.length; i++) {
    if (i < signalValidFrom) continue;
    if (Number.isNaN(sig)) {
      // seed: mean of the first `signal` MACD values
      let sum = 0;
      for (let k = firstValid; k <= signalValidFrom; k++) sum += macdLine[k];
      sig = sum / signal;
    } else {
      sig = alpha * macdLine[i] + (1 - alpha) * sig;
    }
    out[i] = { macd: macdLine[i], signal: sig, histogram: macdLine[i] - sig };
  }
  return out;
}

// ---------------------------------------------------------------------------
// VWAP (anchored per UTC trading day over the loaded window)
// ---------------------------------------------------------------------------

/**
 * Volume-weighted average price, reset at each UTC day boundary. Requires a
 * candle array sorted ascending by openTime. Slot 0 is NaN.
 */
export function vwap(candles: CandleLike[]): number[] {
  return aligned(candles.length, (i) => {
    if (i === 0) return nan;
    const day = utcDay(candles[i].openTime);
    let pv = 0;
    let vol = 0;
    for (let k = i; k >= 0; k--) {
      if (k !== i && utcDay(candles[k].openTime) !== day) break;
      pv += typicalPrice(candles[k]) * candles[k].volume;
      vol += candles[k].volume;
    }
    return vol === 0 ? nan : pv / vol;
  });
}

function typicalPrice(c: CandleLike): number {
  return (c.high + c.low + c.close) / 3;
}

const MS_PER_DAY = 86_400_000;
function utcDay(ts: number): number {
  return Math.floor(ts / MS_PER_DAY);
}

// ---------------------------------------------------------------------------
// Bollinger Bands
// ---------------------------------------------------------------------------

export interface BollingerPoint {
  upper: number;
  middle: number;
  lower: number;
}

/** Bollinger Bands (middle = SMA, ± mult·stdev over `period`). */
export function bollingerBands(values: number[], period = 20, mult = 2): BollingerPoint[] {
  const mids = sma(values, period);
  return aligned(values.length, (i) => {
    const mid = mids[i];
    if (!Number.isFinite(mid)) return { upper: nan, middle: nan, lower: nan };
    let variance = 0;
    for (let k = i - period + 1; k <= i; k++) variance += (values[k] - mid) ** 2;
    const sd = Math.sqrt(variance / period);
    return { upper: mid + mult * sd, middle: mid, lower: mid - mult * sd };
  });
}

// ---------------------------------------------------------------------------
// ATR (Wilder's smoothing) — single-pass, iterative
// ---------------------------------------------------------------------------

/**
 * Average True Range (Wilder). Needs `period` TR values (TR[0] undefined →
 * skipped), so output is valid from index `period`; earlier slots are NaN.
 */
export function atr(candles: CandleLike[], period = 14): number[] {
  const out = aligned(candles.length, () => nan);
  if (candles.length <= period) return out;

  let trSum = 0;
  for (let k = 1; k <= period; k++) trSum += trueRange(candles[k], candles[k - 1]);
  let atrPrev = trSum / period;
  out[period] = atrPrev;

  for (let i = period + 1; i < candles.length; i++) {
    const tr = trueRange(candles[i], candles[i - 1]);
    atrPrev = (atrPrev * (period - 1) + tr) / period;
    out[i] = atrPrev;
  }
  return out;
}

function trueRange(c: CandleLike, prev: CandleLike): number {
  return Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close));
}
