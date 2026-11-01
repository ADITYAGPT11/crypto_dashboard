import type { Candle } from "../types/marketData";
import type {
  Outcome,
  PatternHit,
  PatternType,
  SetupLocation,
  SetupOccurrence,
  SetupStats,
  Verdict,
  Zone,
} from "../types/analysis";
import { atr } from "./indicators";
import { detectAllPatterns } from "./patterns";
import { detectZones, activeZonesAt } from "./zones";
import { mean, median, wilson } from "./stats";

/** A setup must resolve (target or stop) within this many candles. */
export const MAX_HOLD_BARS = 30;
/** Fewer resolved cases than this cannot support a verdict. */
export const MIN_SAMPLE = 30;

export const LOCATION_LABELS: Record<SetupLocation, string> = {
  demandZone: "in demand zone",
  openSpace: "in open space",
};

export function setupKey(type: PatternType, location: SetupLocation): string {
  return `${type}|${location}`;
}

/**
 * Walk forward from the confirmation candle. A stop touch is checked before a
 * target touch on the same candle (conservative: we can't know the order).
 * "expired" = neither within MAX_HOLD_BARS; "open" = ran out of data first.
 */
export function evaluateOutcome(
  candles: Candle[],
  hit: PatternHit,
  maxBars = MAX_HOLD_BARS,
): Outcome {
  const last = Math.min(hit.index + maxBars, candles.length - 1);
  for (let j = hit.index + 1; j <= last; j++) {
    const c = candles[j];
    if (c.low <= hit.stop) {
      return {
        result: "loss",
        exitIndex: j,
        movePct: ((hit.stop - hit.entry) / hit.entry) * 100,
        r: -1,
        bars: j - hit.index,
      };
    }
    if (c.high >= hit.target) {
      const risk = hit.entry - hit.stop;
      return {
        result: "win",
        exitIndex: j,
        movePct: ((hit.target - hit.entry) / hit.entry) * 100,
        r: risk > 0 ? (hit.target - hit.entry) / risk : 0,
        bars: j - hit.index,
      };
    }
  }
  const ranOut = hit.index + maxBars > candles.length - 1;
  return {
    result: ranOut ? "open" : "expired",
    exitIndex: null,
    movePct: 0,
    r: 0,
    bars: last - hit.index,
  };
}

/**
 * A setup is "in a demand zone" when the pattern's low sits within an intact
 * demand zone (±0.25 ATR) that existed before the pattern started.
 */
export function locate(hit: PatternHit, zones: Zone[], atrAtHit: number): SetupLocation {
  const firstIndex = Math.min(...hit.points.map((p) => p.index), hit.index);
  const pad = Number.isFinite(atrAtHit) ? 0.25 * atrAtHit : 0;
  const inside = activeZonesAt(zones, hit.index, "demand").some(
    (z) => z.formedIndex < firstIndex && hit.low >= z.low - pad && hit.low <= z.high + pad,
  );
  return inside ? "demandZone" : "openSpace";
}

export interface SymbolAnalysis {
  symbol: string;
  zones: Zone[];
  occurrences: SetupOccurrence[];
}

/**
 * Detect zones and patterns on closed candles only, place each pattern, and
 * resolve its outcome. Pass only closed candles (drop the forming one).
 */
export function analyzeSymbol(symbol: string, candles: Candle[]): SymbolAnalysis {
  const zones = detectZones(candles);
  const atrs = atr(candles, 14);
  const occurrences = detectAllPatterns(candles).map((hit) => ({
    symbol,
    hit,
    location: locate(hit, zones, atrs[hit.index]),
    outcome: evaluateOutcome(candles, hit),
    time: candles[hit.index].openTime,
  }));
  return { symbol, zones, occurrences };
}

export function verdictFor(n: number, ciLow: number, breakEven: number): Verdict {
  if (n < MIN_SAMPLE) return "tooFew";
  return ciLow > breakEven ? "edge" : "noEdge";
}

/** Aggregate resolved occurrences of one setup (any mix of symbols). */
export function summarize(
  type: PatternType,
  location: SetupLocation,
  occ: SetupOccurrence[],
): SetupStats {
  const resolved = occ.filter((o) => o.outcome.result === "win" || o.outcome.result === "loss");
  const winsList = resolved.filter((o) => o.outcome.result === "win");
  const lossList = resolved.filter((o) => o.outcome.result === "loss");
  const n = resolved.length;
  const wins = winsList.length;
  const ci = wilson(wins, n);
  const avgWinPct = mean(winsList.map((o) => o.outcome.movePct));
  const avgLossPct = mean(lossList.map((o) => o.outcome.movePct));
  const avgWinR = mean(winsList.map((o) => o.outcome.r));
  // Break-even win rate p* solves p·W = (1 − p)·L with W in R and L = 1R.
  const breakEven = avgWinR > 0 ? 1 / (1 + avgWinR) : 0.5;
  return {
    key: setupKey(type, location),
    type,
    location,
    n,
    wins,
    losses: lossList.length,
    expired: occ.filter((o) => o.outcome.result === "expired").length,
    winRate: n ? wins / n : 0,
    ci,
    breakEven,
    avgWinPct,
    avgLossPct,
    expectancyR: mean(resolved.map((o) => o.outcome.r)),
    medianBars: median(resolved.map((o) => o.outcome.bars)),
    verdict: verdictFor(n, ci[0], breakEven),
    recent: [...resolved].sort((a, b) => b.time - a.time).slice(0, 5),
  };
}

/** Stats for every setup key present in the occurrences. */
export function summarizeAll(occ: SetupOccurrence[]): Map<string, SetupStats> {
  const groups = new Map<string, SetupOccurrence[]>();
  for (const o of occ) {
    const key = setupKey(o.hit.type, o.location);
    const list = groups.get(key) ?? [];
    list.push(o);
    groups.set(key, list);
  }
  const out = new Map<string, SetupStats>();
  for (const [key, list] of groups) {
    out.set(key, summarize(list[0].hit.type, list[0].location, list));
  }
  return out;
}

/** Setups confirmed on one of the last `bars` closed candles. */
export function currentSetups(
  analysis: SymbolAnalysis,
  closedCount: number,
  bars = 3,
): SetupOccurrence[] {
  return analysis.occurrences.filter((o) => o.hit.index >= closedCount - bars);
}

export interface CurrentSetup {
  occurrence: SetupOccurrence;
  /** The same setup across every analysed symbol. */
  pooled: SetupStats;
  /** The same setup on this symbol only. */
  own: SetupStats;
}

export interface Scan {
  analyses: Map<string, SymbolAnalysis>;
  pooled: Map<string, SetupStats>;
  /** Setups confirmed on the last few closed candles of each symbol, newest first. */
  current: CurrentSetup[];
}

/** Analyse every symbol, pool the statistics, and list what is setting up now. */
export function buildScan(
  histories: { symbol: string; candles: Candle[] }[],
  recentBars = 3,
): Scan {
  const analyses = new Map<string, SymbolAnalysis>();
  const all: SetupOccurrence[] = [];
  for (const h of histories) {
    const a = analyzeSymbol(h.symbol, h.candles);
    analyses.set(h.symbol, a);
    all.push(...a.occurrences);
  }
  const pooled = summarizeAll(all);
  const current: CurrentSetup[] = [];
  for (const h of histories) {
    const a = analyses.get(h.symbol)!;
    const own = summarizeAll(a.occurrences);
    for (const o of currentSetups(a, h.candles.length, recentBars)) {
      const key = setupKey(o.hit.type, o.location);
      current.push({ occurrence: o, pooled: pooled.get(key)!, own: own.get(key)! });
    }
  }
  current.sort((x, y) => y.occurrence.time - x.occurrence.time);
  return { analyses, pooled, current };
}
