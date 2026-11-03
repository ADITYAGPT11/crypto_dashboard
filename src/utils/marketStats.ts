/**
 * Market-overview statistics computed from closed candles: volatility, ATR,
 * trend, correlation, volatility regime, breadth, trading sessions, top movers
 * and a bubble layout. Pure and deterministic; observations, not forecasts.
 */
import type { Candle } from "../types/marketData";
import { atr, ema } from "./indicators";

const DAY_MS = 86_400_000;

/** Natural-log returns between consecutive closes. */
export function logReturns(closes: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0 && closes[i] > 0) out.push(Math.log(closes[i] / closes[i - 1]));
  }
  return out;
}

function stdev(values: readonly number[]): number {
  if (values.length < 2) return Number.NaN;
  const m = values.reduce((s, v) => s + v, 0) / values.length;
  const v = values.reduce((s, x) => s + (x - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(v);
}

/**
 * Annualised realised volatility in percent over the last `bars` returns.
 * Crypto trades every day, so a year is 365 days of `intervalMs` bars.
 */
export function realizedVol(closes: readonly number[], bars: number, intervalMs: number): number {
  const r = logReturns(closes.slice(-(bars + 1)));
  if (r.length < Math.max(bars, 2)) return Number.NaN;
  return stdev(r) * Math.sqrt((365 * DAY_MS) / intervalMs) * 100;
}

/** Latest ATR(period) as a percent of the latest close. */
export function atrPct(candles: readonly Candle[], period = 14): number {
  if (candles.length <= period) return Number.NaN;
  const a = atr([...candles], period);
  const last = candles[candles.length - 1].close;
  return (a[a.length - 1] / last) * 100;
}

/** True when the latest close is above its EMA(period); null without enough data. */
export function aboveEma(closes: readonly number[], period = 50): boolean | null {
  if (closes.length < period) return null;
  const e = ema([...closes], period);
  return closes[closes.length - 1] > e[e.length - 1];
}

/** Percent change from the close `bars` candles ago to the latest close. */
export function changePct(closes: readonly number[], bars: number): number {
  if (closes.length <= bars) return Number.NaN;
  const then = closes[closes.length - 1 - bars];
  return ((closes[closes.length - 1] - then) / then) * 100;
}

/** Pearson correlation of two equal-length series (NaN when undefined). */
export function correlation(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 3) return Number.NaN;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i];
    mb += b[i];
  }
  ma /= n;
  mb /= n;
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < n; i++) {
    cov += (a[i] - ma) * (b[i] - mb);
    va += (a[i] - ma) ** 2;
    vb += (b[i] - mb) ** 2;
  }
  return va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : Number.NaN;
}

/**
 * Correlation of log returns for every pair, over the last `bars` candles that all
 * symbols share (aligned on open time, so a missing candle never shifts a series).
 */
export function correlationMatrix(
  series: ReadonlyMap<string, readonly Candle[]>,
  bars: number,
): { symbols: string[]; values: number[][] } {
  const symbols = [...series.keys()];
  const maps = symbols.map((s) => new Map(series.get(s)!.map((c) => [c.openTime, c.close])));
  const common = [...(maps[0]?.keys() ?? [])]
    .filter((t) => maps.every((m) => m.has(t)))
    .sort((x, y) => x - y)
    .slice(-(bars + 1));
  const returns = maps.map((m) => logReturns(common.map((t) => m.get(t)!)));
  const values = symbols.map((_, i) =>
    symbols.map((__, j) => (i === j ? 1 : correlation(returns[i], returns[j]))),
  );
  return { symbols, values };
}

/** Share of `values` strictly below `x`, in [0, 1]. */
export function percentileRank(values: readonly number[], x: number): number {
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0 || !Number.isFinite(x)) return Number.NaN;
  return finite.filter((v) => v < x).length / finite.length;
}

export type VolRegime = "calm" | "normal" | "elevated";

export interface VolRegimeResult {
  /** Current annualised volatility (%) over `windowDays`. */
  current: number;
  /** Where it ranks among the same window measured daily over the lookback, 0–1. */
  percentile: number;
  regime: VolRegime;
  /** Number of daily samples the percentile is based on. */
  samples: number;
}

/**
 * Volatility regime: today's `windowDays` realised volatility ranked against the
 * same measure on each of the previous `lookbackDays` days. Below the 33rd
 * percentile is calm, above the 67th elevated. Says nothing about direction.
 */
export function volRegime(
  candles: readonly Candle[],
  intervalMs: number,
  windowDays = 7,
  lookbackDays = 365,
): VolRegimeResult | null {
  const perDay = Math.round(DAY_MS / intervalMs);
  const bars = windowDays * perDay;
  const closes = candles.map((c) => c.close);
  if (closes.length < bars + 1 + perDay * 30) return null;
  const current = realizedVol(closes, bars, intervalMs);
  const history: number[] = [];
  for (let d = 1; d <= lookbackDays; d++) {
    const end = closes.length - d * perDay;
    if (end < bars + 1) break;
    history.push(realizedVol(closes.slice(0, end), bars, intervalMs));
  }
  const percentile = percentileRank(history, current);
  const regime: VolRegime =
    percentile < 1 / 3 ? "calm" : percentile > 2 / 3 ? "elevated" : "normal";
  return { current, percentile, regime, samples: history.length };
}

export interface Session {
  name: string;
  /** Open and close hour, UTC. */
  open: number;
  close: number;
  isOpen: boolean;
}

/**
 * Main trading sessions in UTC (approximate, fixed hours without daylight saving).
 * Crypto trades nonstop; these mark when each region's traders are most active.
 */
export const SESSIONS: readonly Omit<Session, "isOpen">[] = [
  { name: "Asia", open: 0, close: 9 },
  { name: "London", open: 7, close: 16 },
  { name: "New York", open: 13, close: 22 },
];

export function sessionsAt(nowMs: number): { hour: number; sessions: Session[] } {
  const hour = (nowMs % DAY_MS) / 3_600_000;
  return {
    hour,
    sessions: SESSIONS.map((s) => ({ ...s, isOpen: hour >= s.open && hour < s.close })),
  };
}

/** Top `n` by change, and bottom `n` (most negative first); a coin is never in both. */
export function topMovers<T extends { change: number }>(
  items: readonly T[],
  n: number,
): { gainers: T[]; losers: T[] } {
  const valid = items.filter((i) => Number.isFinite(i.change));
  const sorted = [...valid].sort((a, b) => b.change - a.change);
  const k = Math.min(n, Math.floor(sorted.length / 2));
  return { gainers: sorted.slice(0, k), losers: sorted.slice(-k).reverse() };
}

export interface BubbleInput {
  id: string;
  weight: number;
}

export interface Bubble {
  id: string;
  x: number;
  y: number;
  r: number;
}

/**
 * Place circles (radius ∝ √weight, so area ∝ weight) inside a width × height box
 * without overlap: largest first at the centre, each next one at the first free
 * spot along a spiral. Deterministic for the same input.
 */
export function layoutBubbles(
  items: readonly BubbleInput[],
  width: number,
  height: number,
  gap = 6,
): Bubble[] {
  const valid = items.filter((i) => Number.isFinite(i.weight) && i.weight > 0);
  if (valid.length === 0) return [];
  const sorted = [...valid].sort((a, b) => b.weight - a.weight);
  const maxW = sorted[0].weight;
  const maxR = Math.min(width, height) * 0.2;
  const minR = Math.min(width, height) * 0.07;
  const placed: Bubble[] = [];
  for (const item of sorted) {
    const r = minR + (maxR - minR) * Math.sqrt(item.weight / maxW);
    let spot: Bubble | null = null;
    for (let step = 0; step < 4000 && !spot; step++) {
      const angle = step * 0.35;
      const dist = step * 0.9;
      const x = width / 2 + Math.cos(angle) * dist * (width / height);
      const y = height / 2 + Math.sin(angle) * dist;
      if (x - r < 0 || x + r > width || y - r < 0 || y + r > height) continue;
      if (placed.every((p) => Math.hypot(p.x - x, p.y - y) >= p.r + r + gap)) {
        spot = { id: item.id, x, y, r };
      }
    }
    if (spot) placed.push(spot);
  }
  return placed;
}
