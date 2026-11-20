import type { StatsOut } from "../api/schema";
import type { SetupStats, Verdict } from "../types/analysis";
import { fromSetupStat } from "./setupKeys";

/** "after" = what price did after the pattern; "plan" = the stop / target record. */
export type LibraryView = "after" | "plan";
export type VsRandom = "better" | "notBetter" | "tooFew";
export type LibraryFilter = "all" | Verdict | VsRandom;
export type LibrarySort = "n" | "winRate" | "expectancy" | "favourable" | "avgMove";

/** Every setup of a statistics response, keyed `pattern|direction|location`. */
export function statsByKey(stats: StatsOut | null): Map<string, SetupStats> {
  const out = new Map<string, SetupStats>();
  for (const s of stats?.setups ?? []) {
    const st = fromSetupStat(s);
    if (st) out.set(st.key, st);
  }
  return out;
}

/** Setups matching the filter of the view, sorted descending by the chosen measure. */
export function filterAndSort(
  stats: readonly SetupStats[],
  filter: LibraryFilter,
  sort: LibrarySort,
  view: LibraryView = "plan",
): SetupStats[] {
  const after = view === "after";
  const n = (s: SetupStats) => (after ? (s.ride?.n ?? 0) : s.n);
  const measure = (s: SetupStats): number => {
    switch (sort) {
      case "n":
        return n(s);
      case "winRate":
        return s.winRate;
      case "expectancy":
        return s.expectancyR;
      case "favourable":
        return s.ride?.favourableRate ?? -Infinity;
      case "avgMove":
        return s.ride?.avgMovePct ?? -Infinity;
    }
  };
  const verdict = (s: SetupStats): string => (after ? (s.ride?.vsRandom ?? "tooFew") : s.verdict);
  return stats
    .filter((s) => filter === "all" || verdict(s) === filter)
    .sort((a, b) => measure(b) - measure(a) || n(b) - n(a));
}

export interface LibraryTotals {
  setups: number;
  resolved: number;
  edge: number;
  tooFew: number;
  /** Setups whose after-pattern moves beat random candles. */
  beatRandom: number;
  /** Closed after-pattern rides. */
  rides: number;
}

export function libraryTotals(stats: readonly SetupStats[]): LibraryTotals {
  return {
    setups: stats.length,
    resolved: stats.reduce((sum, s) => sum + s.n, 0),
    edge: stats.filter((s) => s.verdict === "edge").length,
    tooFew: stats.filter((s) => s.verdict === "tooFew").length,
    beatRandom: stats.filter((s) => s.ride?.vsRandom === "better").length,
    rides: stats.reduce((sum, s) => sum + (s.ride?.n ?? 0), 0),
  };
}
