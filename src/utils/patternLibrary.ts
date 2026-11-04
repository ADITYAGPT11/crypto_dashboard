import type { Candle } from "../types/marketData";
import type {
  LibraryDirection,
  LibraryEvent,
  LibraryKind,
  LibraryPatternStats,
  LibraryStats,
} from "../types/patternLibrary";

/** The Python backend, reached through the Vite dev proxy (vite.config.ts). */
export const LIBRARY_BASE = "/tcs";

export const LIBRARY_KIND_LABELS: Record<LibraryKind, string> = {
  chart: "Chart formations",
  short: "Short-term",
  candlestick: "Candlesticks",
};

/** One row of stats is one pattern traded in one direction. */
export function statsKey(pattern: string, direction: LibraryDirection): string {
  return `${pattern}|${direction}`;
}

export function eventId(e: Pick<LibraryEvent, "pattern" | "direction" | "open_time">): string {
  return `${e.pattern}|${e.direction}|${e.open_time}`;
}

export function indexStats(rows: LibraryPatternStats[]): Map<string, LibraryPatternStats> {
  return new Map(rows.map((r) => [statsKey(r.pattern, r.direction), r]));
}

/** Shape the shared <CiBar> expects. */
export function toCiStats(s: LibraryStats): {
  winRate: number;
  ci: [number, number];
  breakEven: number;
  n: number;
} {
  return { winRate: s.win_rate, ci: [s.ci_low, s.ci_high], breakEven: s.break_even, n: s.n };
}

/**
 * Events the list shows: completed on the last few candles first ("now"), then the most
 * recent others, newest first, without duplicates.
 */
export function listEvents(
  current: LibraryEvent[],
  events: LibraryEvent[],
  limit: number,
): { event: LibraryEvent; isNow: boolean }[] {
  const nowIds = new Set(current.map(eventId));
  const seen = new Set<string>();
  const out: { event: LibraryEvent; isNow: boolean }[] = [];
  const ordered = [...current, ...events].sort((a, b) => b.open_time - a.open_time);
  for (const e of ordered) {
    const id = eventId(e);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ event: e, isNow: nowIds.has(id) });
    if (out.length >= limit) break;
  }
  return out;
}

export interface LibraryMarker {
  time: number;
  result: LibraryEvent["outcome"]["result"];
  current: boolean;
  direction: "up" | "down";
}

/**
 * Past cases of the selected pattern on this coin, as chart markers. Times are the
 * completing candle's open time; only cases whose candle exists on the chart are kept.
 */
export function libraryMarkers(
  cases: LibraryEvent[],
  selected: LibraryEvent,
  candles: Candle[],
): LibraryMarker[] {
  const times = new Set(candles.map((c) => c.openTime));
  const all = cases.some((c) => eventId(c) === eventId(selected)) ? cases : [...cases, selected];
  return all
    .filter((c) => times.has(c.open_time))
    .map((c) => ({
      time: c.open_time,
      result: c.outcome.result,
      current: eventId(c) === eventId(selected),
      direction: c.direction === "bullish" ? ("up" as const) : ("down" as const),
    }))
    .sort((a, b) => a.time - b.time);
}
