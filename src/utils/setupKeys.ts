/**
 * Setup keys and labels. A setup is pattern × direction × location; its key is
 * `pattern|direction|location` (URL- and storage-safe).
 */
import type { SetupStatOut, SummaryOut } from "../api/schema";
import type {
  Direction,
  LocationFilter,
  PatternId,
  SetupLocation,
  SetupStats,
} from "../types/analysis";

export const LOCATIONS: readonly SetupLocation[] = [
  "confluence",
  "zone",
  "orderBlock",
  "openSpace",
];
const LOCATION_FILTERS: readonly LocationFilter[] = [...LOCATIONS, "*"];
const DIRECTIONS: readonly Direction[] = ["long", "short"];
const PATTERN_ID = /^[a-zA-Z][a-zA-Z0-9]{1,40}$/;

export function setupKey(
  pattern: PatternId,
  direction: Direction,
  location: LocationFilter,
): string {
  return `${pattern}|${direction}|${location}`;
}

export interface ParsedSetup {
  pattern: PatternId;
  direction: Direction;
  location: LocationFilter;
}

/** Keys stored before patterns had directions (all of them were bullish). */
const LEGACY_LOCATION: Record<string, SetupLocation> = {
  demandZone: "zone",
  openSpace: "openSpace",
};
const RETIRED = new Set(["tweezersBottom", "threeWhiteSoldiers"]);

/** Parse a setup key from untrusted input (URL, storage). Accepts the old `pattern|location` form. */
export function parseSetupKey(key: string | null | undefined): ParsedSetup | null {
  if (!key) return null;
  const parts = key.split("|");
  if (parts.length === 2) {
    const [pattern, legacy] = parts;
    const location = LEGACY_LOCATION[legacy];
    if (!location || RETIRED.has(pattern) || !PATTERN_ID.test(pattern)) return null;
    return { pattern, direction: "long", location };
  }
  if (parts.length !== 3) return null;
  const [pattern, d, l] = parts;
  const direction = DIRECTIONS.find((x) => x === d);
  const location = LOCATION_FILTERS.find((x) => x === l);
  if (!direction || !location || !PATTERN_ID.test(pattern)) return null;
  return { pattern, direction, location };
}

/** Rewrite an old `pattern|location` key to the current form (unchanged if already current). */
export function normalizeSetupKey(key: string): string | null {
  const p = parseSetupKey(key);
  return p ? setupKey(p.pattern, p.direction, p.location) : null;
}

export function locationLabel(location: LocationFilter, direction: Direction): string {
  const long = direction === "long";
  switch (location) {
    case "confluence":
      return long ? "at demand zone + bullish order block" : "at supply zone + bearish order block";
    case "zone":
      return long ? "in demand zone" : "in supply zone";
    case "orderBlock":
      return long ? "at bullish order block" : "at bearish order block";
    case "openSpace":
      return "in open space";
    case "*":
      return "anywhere";
  }
}

export function toStats(
  pattern: PatternId,
  direction: Direction,
  location: LocationFilter,
  s: SummaryOut,
): SetupStats {
  return {
    key: setupKey(pattern, direction, location),
    pattern,
    direction,
    location,
    n: s.n,
    wins: s.wins,
    losses: s.losses,
    expired: s.expired,
    winRate: s.winRate,
    ci: [s.ciLow, s.ciHigh],
    breakEven: s.breakEven,
    avgWinPct: s.avgWinPct,
    avgLossPct: s.avgLossPct,
    expectancyR: s.expectancyR,
    medianBars: s.medianBars,
    verdict: s.verdict,
  };
}

export function fromSetupStat(s: SetupStatOut): SetupStats | null {
  const location = LOCATION_FILTERS.find((x) => x === s.location);
  return location ? toStats(s.pattern, s.direction, location, s.summary) : null;
}
