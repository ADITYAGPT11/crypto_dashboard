/**
 * Footprint (volume by price inside each candle, split by aggressor side) from public trades.
 *
 * Each trade lands in the bar of its time and the price row of its price. `bid` is volume sold
 * by aggressive sellers (hitting the bid), `ask` volume bought by aggressive buyers (lifting the
 * ask). Display only, live since the page opened: the full trade history is not free to get at
 * scale, and nothing here feeds a statistic.
 *
 * Imbalance follows the usual diagonal reading: buyers at price p lift offers the sellers at
 * p − step left, so ask(p) is compared with bid(p − step), and bid(p) with ask(p + step).
 */
import type { Candle, TradeEvent } from "../types/marketData";

export interface FootprintRow {
  /** Aggressive sell volume (base units). */
  bid: number;
  /** Aggressive buy volume (base units). */
  ask: number;
}

export interface FootprintBar {
  openTime: number;
  /** Row index (price = index × step) → volumes. */
  rows: Map<number, FootprintRow>;
  volume: number;
  /** ask − bid over the bar. */
  delta: number;
  /** Row index with the most volume (point of control). */
  poc: number;
}

/** A "nice" price step (1, 2, 2.5 or 5 × 10^k) close to `x`. */
export function niceStep(x: number): number {
  if (!(x > 0) || !Number.isFinite(x)) return 1;
  const exp = Math.floor(Math.log10(x));
  const base = 10 ** exp;
  const f = x / base;
  const nice = f < 1.5 ? 1 : f < 2.25 ? 2 : f < 3.5 ? 2.5 : f < 7.5 ? 5 : 10;
  return nice * base;
}

/** Row size giving about `rows` rows across a typical recent candle's range. */
export function autoStep(candles: readonly Candle[], rows = 12, lookback = 50): number {
  const recent = candles
    .slice(-lookback)
    .map((c) => c.high - c.low)
    .filter((r) => r > 0);
  if (recent.length === 0) return 1;
  const sorted = [...recent].sort((a, b) => a - b);
  return niceStep(sorted[Math.floor(sorted.length / 2)] / rows);
}

/** Row index of `price` for `step` (rounded to cope with float steps such as 0.01). */
export function rowOf(price: number, step: number): number {
  return Math.floor(price / step + 1e-9);
}

/** Bar open time for `time` (weekly bars open on Monday, like the exchange's). */
export function barOpen(time: number, intervalMs: number): number {
  const WEEK = 7 * 86_400_000;
  const off = intervalMs === WEEK ? 4 * 86_400_000 : 0;
  return Math.floor((time - off) / intervalMs) * intervalMs + off;
}

/** Accumulates trades into footprint bars for one interval and row size. */
export class FootprintBook {
  private readonly bars = new Map<number, FootprintBar>();

  constructor(
    readonly intervalMs: number,
    readonly step: number,
    /** Bars kept (oldest dropped first). */
    private readonly maxBars = 300,
  ) {}

  add(t: TradeEvent): void {
    if (!(t.price > 0) || !(t.quantity > 0)) return;
    const open = barOpen(t.timeStamp, this.intervalMs);
    let bar = this.bars.get(open);
    if (!bar) {
      bar = {
        openTime: open,
        rows: new Map(),
        volume: 0,
        delta: 0,
        poc: rowOf(t.price, this.step),
      };
      this.bars.set(open, bar);
      if (this.bars.size > this.maxBars) {
        const oldest = Math.min(...this.bars.keys());
        this.bars.delete(oldest);
      }
    }
    const r = rowOf(t.price, this.step);
    let row = bar.rows.get(r);
    if (!row) {
      row = { bid: 0, ask: 0 };
      bar.rows.set(r, row);
    }
    if (t.buyerMaker) {
      row.bid += t.quantity;
      bar.delta -= t.quantity;
    } else {
      row.ask += t.quantity;
      bar.delta += t.quantity;
    }
    bar.volume += t.quantity;
    const poc = bar.rows.get(bar.poc);
    if (!poc || row.bid + row.ask > poc.bid + poc.ask) bar.poc = r;
  }

  /** Bars ascending by open time (a snapshot: rows are copied). */
  snapshot(): FootprintBar[] {
    return [...this.bars.values()]
      .sort((a, b) => a.openTime - b.openTime)
      .map((b) => ({
        ...b,
        rows: new Map([...b.rows].map(([k, v]) => [k, { ...v }])),
      }));
  }
}

export type Imbalance = "buy" | "sell" | null;

/**
 * Diagonal imbalance of row `r`: buyers at r took at least `ratio` × what sellers did one row
 * lower ("buy"), or sellers at r at least `ratio` × buyers one row higher ("sell"). A missing
 * neighbour counts as zero volume, so a lone print needs `minVolume` to count.
 */
export function imbalanceAt(bar: FootprintBar, r: number, ratio = 3, minVolume = 0): Imbalance {
  const row = bar.rows.get(r);
  if (!row) return null;
  const below = bar.rows.get(r - 1)?.bid ?? 0;
  const above = bar.rows.get(r + 1)?.ask ?? 0;
  if (row.ask >= minVolume && row.ask > 0 && row.ask >= ratio * below) return "buy";
  if (row.bid >= minVolume && row.bid > 0 && row.bid >= ratio * above) return "sell";
  return null;
}

/** Compact volume: 0.42, 12.3, 1.2K, 3.4M. */
export function compactVolume(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e4) return `${(v / 1e3).toFixed(0)}K`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  if (a >= 100) return v.toFixed(0);
  if (a >= 10) return v.toFixed(1);
  return v.toFixed(2);
}
