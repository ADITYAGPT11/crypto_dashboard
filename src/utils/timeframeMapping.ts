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
import type { OccurrenceOut } from "../api/schema";
import type { Direction, FairValueGap, OrderBlock, PatternId, Zone } from "../types/analysis";
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

export interface ViewLine {
  x1: number;
  p1: number;
  x2: number;
  p2: number;
  label: string;
}

export interface ViewPattern {
  pattern: PatternId;
  direction: Direction;
  tf: CandleInterval;
  /** Key points at the middle of their source candle. */
  points: { x: number; price: number; label: string }[];
  /** Source candles of the key points and the confirmation, as view ranges. */
  blocks: Span[];
  /** Where the signal exists: close of the confirmation candle. */
  entryX: number;
  /** Start of the pattern (first candle of the formation). */
  startX: number;
  /** Necklines, trendlines and flag lines. */
  lines: ViewLine[];
  /** The pattern's extreme (low for longs, high for shorts): where its tag sits. */
  extreme: number;
}

/** Map an occurrence detected on `tf` candles onto the view (everything is by time). */
export function toViewPattern(
  occ: OccurrenceOut,
  tf: CandleInterval,
  view: readonly Candle[],
  viewTf: CandleInterval,
): ViewPattern {
  const ms = TF_MS[tf];
  const vms = TF_MS[viewTf];
  const span = (time: number) => spanOf(view, vms, time, ms);
  const mid = (time: number) => {
    const s = span(time);
    return (s.from + s.to) / 2;
  };
  const keys = [...new Set([...occ.points.map((p) => p.time), occ.time])].sort((a, b) => a - b);
  return {
    pattern: occ.pattern,
    direction: occ.direction,
    tf,
    points: [...occ.points]
      .sort((a, b) => a.time - b.time)
      .map((p) => ({ x: mid(p.time), price: p.price, label: p.label })),
    blocks: keys.map(span),
    entryX: span(occ.time).to,
    startX: span(occ.startTime).from,
    lines: occ.lines.map((l) => ({
      x1: mid(l.a.time),
      p1: l.a.price,
      x2: mid(l.b.time),
      p2: l.b.price,
      label: l.label,
    })),
    extreme: occ.extreme,
  };
}

export type LevelLayer = "zone" | "orderBlock" | "fvg";

export interface ViewLevel {
  layer: LevelLayer;
  /** demand / supply for zones, bullish / bearish for order blocks and gaps. */
  kind: "demand" | "supply" | "bullish" | "bearish";
  tf: CandleInterval;
  low: number;
  high: number;
  from: number;
  /** null while intact (extends to the right edge). */
  to: number | null;
  /** Untested zone / unmitigated block. */
  fresh: boolean;
}

/** Map zones, order blocks and gaps detected on `tf` candles onto the view. */
export function toViewLevels(
  levels: { zones: Zone[]; orderBlocks: OrderBlock[]; fvgs: FairValueGap[] },
  tf: CandleInterval,
  view: readonly Candle[],
  viewTf: CandleInterval,
): ViewLevel[] {
  const ms = TF_MS[tf];
  const vms = TF_MS[viewTf];
  const at = (time: number) => logicalAt(view, vms, time);
  const end = (time: number | null) => (time === null ? null : at(time + ms));
  return [
    ...levels.zones.map((z) => ({
      layer: "zone" as const,
      kind: z.kind,
      tf,
      low: z.low,
      high: z.high,
      from: at(z.startTime),
      to: end(z.endTime),
      fresh: z.tests === 0,
    })),
    ...levels.orderBlocks.map((b) => ({
      layer: "orderBlock" as const,
      kind: b.kind,
      tf,
      low: b.low,
      high: b.high,
      from: at(b.time),
      to: end(b.endTime),
      fresh: b.mitigatedTime === null,
    })),
    ...levels.fvgs.map((g) => ({
      layer: "fvg" as const,
      kind: g.kind,
      tf,
      low: g.low,
      high: g.high,
      from: at(g.time),
      to: end(g.filledTime),
      fresh: true,
    })),
  ];
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
