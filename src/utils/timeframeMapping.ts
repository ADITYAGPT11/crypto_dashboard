/**
 * Draw analysis from one timeframe on a chart of another. Everything is mapped
 * through time into the view's logical (bar-index) space, which may be
 * fractional: bar i spans [i − 0.5, i + 0.5].
 *
 * - A 4h candle on a 1h view becomes a 4-bar-wide block.
 * - A 1h candle on a 4h view becomes a quarter of one bar.
 * - A pattern's signal time is the CLOSE of its confirmation candle, so on a
 *   lower view the entry sits after the last lower candle of that block.
 */
import type { Candle, CandleInterval } from "../types/marketData";
import type { PatternType, SetupOccurrence, Zone } from "../types/analysis";
import { INTERVAL_TO_MS } from "./candleUtils";

export const TF_MS: Record<CandleInterval, number> = INTERVAL_TO_MS;

/** Index of the last view candle opening at or before `time` (−1 if none). */
function barAt(view: readonly Candle[], time: number): number {
  let lo = 0;
  let hi = view.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (view[mid].openTime <= time) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

/** Fractional logical position of a moment in time on the view. */
export function logicalAt(view: readonly Candle[], viewMs: number, time: number): number {
  if (view.length === 0) return Number.NaN;
  const i = Math.max(0, barAt(view, time));
  return i - 0.5 + (time - view[i].openTime) / viewMs;
}

export interface Span {
  from: number;
  to: number;
}

/** The view range covered by a candle of another timeframe opening at `open`. */
export function spanOf(view: readonly Candle[], viewMs: number, open: number, durMs: number): Span {
  return { from: logicalAt(view, viewMs, open), to: logicalAt(view, viewMs, open + durMs) };
}

export interface ViewPattern {
  type: PatternType;
  tf: CandleInterval;
  /** Key points at the middle of their source candle. */
  points: { x: number; price: number }[];
  /** Source candles of the key points and the confirmation, as view ranges. */
  blocks: Span[];
  /** Where the signal exists: close of the confirmation candle. */
  entryX: number;
  /** Start of the pattern (first key candle). */
  startX: number;
  neckline?: number;
  /** Sloped neckline / flag line between two view positions. */
  line?: { x1: number; p1: number; x2: number; p2: number };
  low: number;
  /** Highest high of the confirmation candle and the one before (box top). */
  high: number;
}

/** Map an occurrence detected on `source` candles onto the view. */
export function toViewPattern(
  occ: SetupOccurrence,
  tf: CandleInterval,
  source: readonly Candle[],
  view: readonly Candle[],
  viewTf: CandleInterval,
): ViewPattern {
  const ms = TF_MS[tf];
  const vms = TF_MS[viewTf];
  const span = (i: number) => spanOf(view, vms, source[i].openTime, ms);
  const hit = occ.hit;
  const keys = [...new Set([...hit.points.map((p) => p.index), hit.index])].sort((a, b) => a - b);
  const conf = span(hit.index);
  return {
    type: hit.type,
    tf,
    points: hit.points.map((p) => {
      const s = span(p.index);
      return { x: (s.from + s.to) / 2, price: p.price };
    }),
    blocks: keys.map(span),
    entryX: conf.to,
    startX: span(keys[0]).from,
    neckline: hit.neckline,
    line: hit.line
      ? (() => {
          const a = span(hit.line.from.index);
          const b = span(hit.line.to.index);
          return {
            x1: (a.from + a.to) / 2,
            p1: hit.line.from.price,
            x2: (b.from + b.to) / 2,
            p2: hit.line.to.price,
          };
        })()
      : undefined,
    low: hit.low,
    high: Math.max(source[hit.index].high, source[Math.max(0, hit.index - 1)].high),
  };
}

export interface ViewZone {
  kind: Zone["kind"];
  tf: CandleInterval;
  low: number;
  high: number;
  from: number;
  /** null while intact (extends to the right edge). */
  to: number | null;
}

/** Map zones detected on `source` candles onto the view. */
export function toViewZones(
  zones: readonly Zone[],
  tf: CandleInterval,
  source: readonly Candle[],
  view: readonly Candle[],
  viewTf: CandleInterval,
): ViewZone[] {
  const ms = TF_MS[tf];
  const vms = TF_MS[viewTf];
  return zones.map((z) => ({
    kind: z.kind,
    tf,
    low: z.low,
    high: z.high,
    from: logicalAt(view, vms, source[z.startIndex].openTime),
    to: z.endIndex === null ? null : logicalAt(view, vms, source[z.endIndex].openTime + ms),
  }));
}

/** Open time of the view candle in which a source candle closes (for markers). */
export function viewBarTimeForClose(
  view: readonly Candle[],
  sourceOpen: number,
  sourceMs: number,
): number | null {
  const i = barAt(view, sourceOpen + sourceMs - 1);
  return i < 0 ? null : view[i].openTime;
}
