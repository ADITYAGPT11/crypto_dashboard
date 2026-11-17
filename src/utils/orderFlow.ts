/**
 * Order flow from public data: who was aggressive, and how big.
 *
 * Display only (chart indicators and bubbles). Nothing here feeds a statistic; a measured
 * order-flow rule would live in the analysis service (CLAUDE.md conventions).
 *
 * - Delta: aggressive buy volume − aggressive sell volume of a candle. Binance klines report
 *   the taker buy volume, so delta = 2 × takerBuy − volume, exact per candle.
 * - CVD: running sum of delta over the loaded candles. Only its shape matters (the starting
 *   point is wherever the history begins).
 * - Big trades: one taker order can fill against many resting orders; Binance's aggTrade
 *   stream merges fills per price, and every aggTrade of one taker order shares a timestamp
 *   and side. We merge those back into one print and flag it when its notional is above the
 *   99th percentile of recent prints (and above a floor), so the threshold adapts to each coin.
 */
import type { Candle, TradeEvent } from "../types/marketData";

/** Aggressive buy − sell volume (base units), NaN when the source has no taker volume. */
export function candleDelta(c: Candle): number {
  return c.takerBuyVolume == null ? Number.NaN : 2 * c.takerBuyVolume - c.volume;
}

/**
 * Cumulative volume delta. A candle without taker volume gets NaN (drawn as a gap) and adds
 * nothing, so the line continues after it.
 */
export function cumulativeDelta(candles: readonly Candle[]): number[] {
  let sum = 0;
  return candles.map((c) => {
    const d = candleDelta(c);
    if (!Number.isFinite(d)) return Number.NaN;
    sum += d;
    return sum;
  });
}

export interface BigTrade {
  /** Epoch ms of the taker order. */
  time: number;
  /** Volume-weighted price of its fills. */
  price: number;
  /** Base units. */
  quantity: number;
  /** Quote units (USDT). */
  notional: number;
  side: "buy" | "sell";
}

export interface BigTradeOptions {
  /** Top share of recent prints that counts as big (0.99 = top 1%). */
  quantile: number;
  /** Never flag a print below this notional (quote units). */
  minNotional: number;
  /** Recent prints the quantile is taken over. */
  sampleSize: number;
  /** Prints needed before anything is flagged (no threshold from a handful of trades). */
  warmup: number;
  /** Recompute the threshold after this many new prints (sorting every trade is wasteful). */
  recomputeEvery: number;
}

export const BIG_TRADE_DEFAULTS: BigTradeOptions = {
  quantile: 0.99,
  minNotional: 10_000,
  sampleSize: 2_000,
  warmup: 200,
  recomputeEvery: 100,
};

interface Pending {
  time: number;
  side: "buy" | "sell";
  quantity: number;
  notional: number;
}

/** Merges aggTrades into taker orders and flags the big ones. Feed trades in arrival order. */
export class BigTradeDetector {
  private readonly opts: BigTradeOptions;
  private pending: Pending | null = null;
  private sample: number[] = [];
  private next = 0;
  private sinceRecompute = 0;
  private cut = Number.POSITIVE_INFINITY;

  constructor(opts: Partial<BigTradeOptions> = {}) {
    this.opts = { ...BIG_TRADE_DEFAULTS, ...opts };
  }

  /** Current notional threshold, or null while warming up. */
  get threshold(): number | null {
    return Number.isFinite(this.cut) ? this.cut : null;
  }

  /**
   * Add one trade. Returns the previous taker order when this trade starts a new one and the
   * previous one was big; otherwise null.
   */
  push(trade: TradeEvent): BigTrade | null {
    if (!(trade.price > 0) || !(trade.quantity > 0)) return null;
    const side = trade.buyerMaker ? "sell" : "buy";
    const p = this.pending;
    if (p && p.time === trade.timeStamp && p.side === side) {
      p.quantity += trade.quantity;
      p.notional += trade.price * trade.quantity;
      return null;
    }
    const done = p ? this.close(p) : null;
    this.pending = {
      time: trade.timeStamp,
      side,
      quantity: trade.quantity,
      notional: trade.price * trade.quantity,
    };
    return done;
  }

  /** Close the order still being merged (e.g. when the stream goes quiet). */
  flush(): BigTrade | null {
    const p = this.pending;
    this.pending = null;
    return p ? this.close(p) : null;
  }

  private close(p: Pending): BigTrade | null {
    const { sampleSize, warmup, recomputeEvery, quantile, minNotional } = this.opts;
    if (this.sample.length < sampleSize) this.sample.push(p.notional);
    else {
      this.sample[this.next] = p.notional;
      this.next = (this.next + 1) % sampleSize;
    }
    this.sinceRecompute++;
    if (
      this.sample.length >= warmup &&
      (this.sinceRecompute >= recomputeEvery || !this.threshold)
    ) {
      this.sinceRecompute = 0;
      this.cut = Math.max(minNotional, quantileOf(this.sample, quantile));
    }
    // Strictly above the cut: when many prints share the cut's size, none of them is "big".
    if (p.notional <= this.cut) return null;
    return {
      time: p.time,
      price: p.notional / p.quantity,
      quantity: p.quantity,
      notional: p.notional,
      side: p.side,
    };
  }
}

/** The q-quantile (0..1) of the values, nearest rank. */
export function quantileOf(values: readonly number[], q: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[i];
}

/** Bubble radius in px: area grows with notional, from `min` at the threshold up to `max`. */
export function bubbleRadius(notional: number, threshold: number, min = 3, max = 18): number {
  if (!(threshold > 0) || !(notional > 0)) return min;
  return Math.min(max, min * Math.sqrt(notional / threshold));
}

/**
 * Fractional logical position of `time` on a chart of `candles` (bar i is centred on i, so
 * its open is at i − 0.5). Times after the last closed candle continue on the forming bars.
 * Null before the first candle.
 */
export function timeToLogical(
  candles: readonly Candle[],
  time: number,
  intervalMs: number,
): number | null {
  if (candles.length === 0 || time < candles[0].openTime) return null;
  let lo = 0;
  let hi = candles.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (candles[mid].openTime <= time) lo = mid;
    else hi = mid - 1;
  }
  let i = lo;
  let open = candles[lo].openTime;
  if (lo === candles.length - 1 && time >= open + intervalMs) {
    const k = Math.floor((time - open) / intervalMs);
    i += k;
    open += k * intervalMs;
  }
  return i - 0.5 + Math.min(1, (time - open) / intervalMs);
}
