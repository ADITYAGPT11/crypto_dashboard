import type {
  PatternType,
  SetupLocation,
  SetupOccurrence,
  SetupStats,
  Verdict,
} from "../types/analysis";
import { setupKey, summarize, type Scan } from "./setupAnalysis";

export type LibraryFilter = "all" | Verdict;
export type LibrarySort = "n" | "winRate" | "expectancy";

/** Setups matching the verdict filter, sorted descending by the chosen measure. */
export function filterAndSort(
  stats: readonly SetupStats[],
  filter: LibraryFilter,
  sort: LibrarySort,
): SetupStats[] {
  const measure = (s: SetupStats) =>
    sort === "n" ? s.n : sort === "winRate" ? s.winRate : s.expectancyR;
  return stats
    .filter((s) => filter === "all" || s.verdict === filter)
    .sort((a, b) => measure(b) - measure(a) || b.n - a.n);
}

export interface LibraryTotals {
  setups: number;
  resolved: number;
  edge: number;
  tooFew: number;
}

export function libraryTotals(stats: readonly SetupStats[]): LibraryTotals {
  return {
    setups: stats.length,
    resolved: stats.reduce((sum, s) => sum + s.n, 0),
    edge: stats.filter((s) => s.verdict === "edge").length,
    tooFew: stats.filter((s) => s.verdict === "tooFew").length,
  };
}

export interface SymbolBreakdown {
  symbol: string;
  stats: SetupStats;
}

/**
 * The same setup measured on each coin alone, most cases first. Coins without a
 * resolved case are left out. Small per-coin samples are expected: the pooled row
 * is the evidence, this view shows whether one coin carries it.
 */
export function perSymbolStats(scan: Scan, key: string): SymbolBreakdown[] {
  const first = scan.pooled.get(key);
  if (!first) return [];
  const out: SymbolBreakdown[] = [];
  for (const [symbol, analysis] of scan.analyses) {
    const occ: SetupOccurrence[] = analysis.occurrences.filter(
      (o) => setupKey(o.hit.type, o.location) === key,
    );
    const stats = summarize(first.type, first.location, occ);
    if (stats.n > 0) out.push({ symbol, stats });
  }
  return out.sort((a, b) => b.stats.n - a.stats.n || a.symbol.localeCompare(b.symbol));
}

const PATTERN_TYPES: readonly PatternType[] = [
  "doubleBottom",
  "bullishEngulfing",
  "hammer",
  "invertedHammer",
  "bullishHarami",
  "tweezersBottom",
  "threeWhiteSoldiers",
];
const LOCATIONS: readonly SetupLocation[] = ["demandZone", "openSpace"];

/** Parse a `type|location` setup key from untrusted input (URL, storage). */
export function parseSetupKey(
  key: string | null | undefined,
): { type: PatternType; location: SetupLocation } | null {
  if (!key) return null;
  const [type, location, extra] = key.split("|");
  if (extra !== undefined) return null;
  const t = PATTERN_TYPES.find((p) => p === type);
  const l = LOCATIONS.find((p) => p === location);
  return t && l ? { type: t, location: l } : null;
}
