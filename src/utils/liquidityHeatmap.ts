/**
 * Order-book liquidity over time: the data behind the chart's heatmap layer and the
 * "biggest liquidity pools" list.
 *
 * Every few seconds the local book(s) are bucketed by price (notional in quote
 * currency per bucket, bids and asks apart). Columns are kept since the page opened;
 * per chart bar a bucket shows the AVERAGE resting notional over the samples in that
 * bar, so a wall that sat there for the whole bar glows, and one flashed for a
 * second barely shows.
 *
 * Observation, not prediction: visible orders can be pulled or spoofed, and who
 * placed them is unknown. Pools are ranked by size and how long they have rested.
 */
import type { LocalBook } from "./depthBook";

export interface BookSample {
  time: number;
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
export const BUCKETS_ACROSS_BOOK = 50;

/**
 * A round bucket size giving about `BUCKETS_ACROSS_BOOK` buckets between the lowest
 * bid and the highest ask (exchanges send a few hundred to a thousand levels, which
 * for BTC can be only a few dollars either side of the price).
 */
export function bucketForBooks(books: readonly LocalBook[]): number | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const b of books) {
    for (const p of b.bids.keys()) if (p < lo) lo = p;
    for (const p of b.asks.keys()) if (p > hi) hi = p;
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
) {
  for (const [p, q] of side) {
    const k = Math.floor(p / bucket);
    into.set(k, (into.get(k) ?? 0) + p * q);
  }
  return into;
}

/** One sample from one or more books (liquidity from several exchanges adds up). */
export function sampleBooks(
  books: readonly LocalBook[],
  time: number,
  bucket?: number,
): BookSample | null {
  const mids = books.map((b) => b.mid()).filter((m): m is number => m !== null);
  if (mids.length === 0) return null;
  const mid = mids.reduce((s, m) => s + m, 0) / mids.length;
  const size = bucket ?? bucketForBooks(books) ?? bucketSize(mid);
  const bids = new Map<number, number>();
  const asks = new Map<number, number>();
  for (const b of books) {
    bucketBook(b.bids, size, bids);
    bucketBook(b.asks, size, asks);
  }
  return { time, mid, bucket: size, bids, asks };
}

export interface HeatCell {
  /** Bucket bottom price. */
  price: number;
  notional: number;
  side: "bid" | "ask";
}

export interface HeatColumn {
  /** Open time of the chart bar this column belongs to. */
  time: number;
  cells: HeatCell[];
}

export interface HeatmapFrame {
  bucket: number;
  columns: HeatColumn[];
  /** Notional at which the colour saturates (98th percentile of cells). */
  scale: number;
}

/** Average each bucket over the samples inside every chart bar of `barMs`. */
export function heatmapFrame(samples: readonly BookSample[], barMs: number): HeatmapFrame | null {
  if (samples.length === 0) return null;
  const bucket = samples[samples.length - 1].bucket;
  const groups = new Map<number, BookSample[]>();
  for (const s of samples) {
    if (s.bucket !== bucket) continue; // bucket changed (big move): older columns are dropped
    const t = Math.floor(s.time / barMs) * barMs;
    const g = groups.get(t) ?? [];
    g.push(s);
    groups.set(t, g);
  }
  const columns: HeatColumn[] = [];
  const all: number[] = [];
  for (const [time, g] of [...groups].sort((a, b) => a[0] - b[0])) {
    const cells: HeatCell[] = [];
    for (const side of ["bid", "ask"] as const) {
      const sum = new Map<number, number>();
      for (const s of g)
        for (const [k, v] of side === "bid" ? s.bids : s.asks) sum.set(k, (sum.get(k) ?? 0) + v);
      for (const [k, v] of sum) {
        const notional = v / g.length;
        cells.push({ price: k * bucket, notional, side });
        all.push(notional);
      }
    }
    columns.push({ time, cells });
  }
  all.sort((a, b) => a - b);
  const scale = all.length ? all[Math.min(all.length - 1, Math.floor(all.length * 0.98))] : 1;
  return { bucket, columns, scale: scale || 1 };
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
