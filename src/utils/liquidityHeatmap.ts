/**
 * Order-book liquidity over time: the data behind the chart's heatmap layer and the
 * "biggest liquidity pools" list.
 *
 * Every few seconds the local book(s) are bucketed by price (notional in quote
 * currency per bucket, bids and asks apart). Each sample is one column of the heatmap on the
 * time axis (`heatmapRender.ts`); recorded history arrives as one-minute averages.
 *
 * Observation, not prediction: visible orders can be pulled or spoofed, and who
 * placed them is unknown. Pools are ranked by size and how long they have rested.
 */
import type { LocalBook } from "./depthBook";

export interface BookSample {
  time: number;
  /** How long this sample stands for (ms): the sampling interval, or 60 000 for a recorded minute. */
  span?: number;
  mid: number;
  bucket: number;
  /** bucket index (floor(price / bucket)) → notional, per side */
  bids: Map<number, number>;
  asks: Map<number, number>;
}

const NICE = [1, 2, 2.5, 5, 10];

/** The smallest round step (1, 2, 2.5, 5 × 10^k) at or above `raw`. */
export function niceStep(raw: number): number {
  if (!(raw > 0)) return 1;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = NICE.find((n) => n * mag >= raw * (1 - 1e-9)) ?? 10;
  return Number((step * mag).toPrecision(12));
}

/** A round bucket size near `bps` basis points of price (e.g. 5 bps of 74 000 → 50). */
export function bucketSize(price: number, bps = 5): number {
  return price > 0 ? niceStep((price * bps) / 10_000) : 1;
}

/** Buckets across the price range the books actually cover. */
export const BUCKETS_ACROSS_BOOK = 120;

/**
 * Liquidity is aggregated within ±this share of the mid price. Exchanges' books reach very
 * differently (Delta sends its whole book, with stray orders at $0.50 and $12M); one shared
 * window keeps the scale meaningful and every exchange comparable.
 */
export const HEAT_WINDOW = 0.02;

/** Mid price of several books (their average), or null when none has a price. */
export function midOf(books: readonly LocalBook[]): number | null {
  const mids = books.map((b) => b.mid()).filter((m): m is number => m !== null);
  return mids.length ? mids.reduce((s, m) => s + m, 0) / mids.length : null;
}

/** Resting notional (quote currency) of a book inside the heat window around `mid`. */
export function windowNotional(book: LocalBook, mid: number, window = HEAT_WINDOW): number {
  const lo = mid * (1 - window);
  const hi = mid * (1 + window);
  let sum = 0;
  for (const side of [book.bids, book.asks])
    for (const [p, q] of side) if (p >= lo && p <= hi) sum += p * q;
  return sum;
}

/**
 * A round bucket size giving about `BUCKETS_ACROSS_BOOK` buckets between the lowest
 * bid and the highest ask (exchanges send a few hundred to a thousand levels, which
 * for BTC can be only a few dollars either side of the price).
 */
export function bucketForBooks(books: readonly LocalBook[], mid?: number | null): number | null {
  const m = mid ?? midOf(books);
  const floor = m !== null ? m * (1 - HEAT_WINDOW) : -Infinity;
  const ceil = m !== null ? m * (1 + HEAT_WINDOW) : Infinity;
  let lo = Infinity;
  let hi = -Infinity;
  for (const b of books) {
    for (const p of b.bids.keys()) if (p < lo && p >= floor) lo = p;
    for (const p of b.asks.keys()) if (p > hi && p <= ceil) hi = p;
  }
  return hi > lo ? niceStep((hi - lo) / BUCKETS_ACROSS_BOOK) : null;
}

/** Keep the current bucket unless the books' reach changed by more than 2× (history resets then). */
export function stableBucket(current: number | null, proposed: number | null): number | null {
  if (proposed === null) return current;
  if (current === null) return proposed;
  const ratio = proposed / current;
  return ratio > 2 || ratio < 0.5 ? proposed : current;
}

export function bucketBook(
  side: Map<number, number>,
  bucket: number,
  into = new Map<number, number>(),
  lo = -Infinity,
  hi = Infinity,
) {
  for (const [p, q] of side) {
    if (p < lo || p > hi) continue;
    const k = Math.floor(p / bucket);
    into.set(k, (into.get(k) ?? 0) + p * q);
  }
  return into;
}

/**
 * One sample from one or more books: liquidity from several exchanges adds up, within
 * ±`HEAT_WINDOW` of their average mid.
 */
export function sampleBooks(
  books: readonly LocalBook[],
  time: number,
  bucket?: number,
): BookSample | null {
  const mid = midOf(books);
  if (mid === null) return null;
  const size = bucket ?? bucketForBooks(books, mid) ?? bucketSize(mid);
  const lo = mid * (1 - HEAT_WINDOW);
  const hi = mid * (1 + HEAT_WINDOW);
  const bids = new Map<number, number>();
  const asks = new Map<number, number>();
  for (const b of books) {
    bucketBook(b.bids, size, bids, lo, hi);
    bucketBook(b.asks, size, asks, lo, hi);
  }
  return { time, mid, bucket: size, bids, asks };
}

export interface LiquidityPool {
  side: "bid" | "ask";
  low: number;
  high: number;
  notional: number;
  /** Distance from the mid price, percent (negative below). */
  distancePct: number;
  /** How long this bucket has held at least half its current size, ms. */
  restingMs: number;
  /** Multiple of the median bucket on its side. */
  multiple: number;
  /** At least `WALL_MULTIPLE` × the median: stands out from the rest of the book. */
  wall: boolean;
}

export const WALL_MULTIPLE = 3;

/**
 * The largest resting buckets on each side of the latest sample (largest first),
 * with their size relative to the side's median bucket and how long they have rested.
 */
export function liquidityPools(
  samples: readonly BookSample[],
  { perSide = 4 } = {},
): LiquidityPool[] {
  const last = samples[samples.length - 1];
  if (!last) return [];
  const out: LiquidityPool[] = [];
  for (const side of ["bid", "ask"] as const) {
    const m = side === "bid" ? last.bids : last.asks;
    const values = [...m.values()].sort((a, b) => a - b);
    if (values.length < 5) continue;
    const median = values[Math.floor(values.length / 2)];
    const top = [...m].sort((a, b) => b[1] - a[1]).slice(0, perSide);
    for (const [k, notional] of top) {
      let since = last.time;
      for (let i = samples.length - 2; i >= 0; i--) {
        const s = samples[i];
        if (s.bucket !== last.bucket) break;
        const v = (side === "bid" ? s.bids : s.asks).get(k) ?? 0;
        if (v < notional / 2) break;
        since = s.time;
      }
      const low = k * last.bucket;
      const multiple = median > 0 ? notional / median : 0;
      out.push({
        side,
        low,
        high: low + last.bucket,
        notional,
        distancePct: ((low + last.bucket / 2 - last.mid) / last.mid) * 100,
        restingMs: last.time - since,
        multiple,
        wall: multiple >= WALL_MULTIPLE,
      });
    }
  }
  return out.sort((a, b) => b.notional - a.notional);
}

/** One recorded minute from the analysis service (`/api/v1/depth`). */
export interface RecordedColumn {
  time: number;
  bucket: number;
  mid: number;
  bids: [number, number][];
  asks: [number, number][];
}

/** Recorded minutes as samples (one minute each), so they share the live heatmap's maths. */
export function columnsToSamples(columns: readonly RecordedColumn[]): BookSample[] {
  return columns.map((c) => ({
    time: c.time,
    span: 60_000,
    mid: c.mid,
    bucket: c.bucket,
    bids: new Map(c.bids),
    asks: new Map(c.asks),
  }));
}

/**
 * Recorded history followed by this tab's live samples: history only up to where live sampling
 * began (no minute is counted twice).
 */
export function mergeSamples(
  history: readonly BookSample[],
  live: readonly BookSample[],
): readonly BookSample[] {
  if (history.length === 0) return live;
  const start = live[0]?.time ?? Number.POSITIVE_INFINITY;
  const before = history.filter((s) => s.time + (s.span ?? 0) <= start);
  return before.length === 0 ? live : [...before, ...live];
}
