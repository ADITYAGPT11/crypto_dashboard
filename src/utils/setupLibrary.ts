import type { StatsOut } from "../api/schema";
import type { SetupStats, Verdict } from "../types/analysis";
import { fromSetupStat } from "./setupKeys";

export type LibraryFilter = "all" | Verdict;
export type LibrarySort = "n" | "winRate" | "expectancy";

/** Every setup of a statistics response, keyed `pattern|direction|location`. */
export function statsByKey(stats: StatsOut | null): Map<string, SetupStats> {
  const out = new Map<string, SetupStats>();
  for (const s of stats?.setups ?? []) {
    const st = fromSetupStat(s);
    if (st) out.set(st.key, st);
  }
  return out;
}

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
