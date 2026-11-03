/**
 * Which timeframes each pattern is detected on and where zones come from.
 * Chosen by the user; independent of the chart's view timeframe.
 *
 * These pick between setups that are each measured separately (a 4h double
 * bottom in 1d zones has its own statistics), so they never tune a rule.
 * The rules themselves stay fixed (preset v1) until versioned presets exist.
 */
import type { CandleInterval } from "../types/marketData";
import type { PatternType } from "../types/analysis";

export const DETECTION_TFS: readonly CandleInterval[] = ["1h", "4h", "1d"];
export type ZoneSourceOption = "same" | "4h" | "1d";
export const ZONE_OPTIONS: readonly ZoneSourceOption[] = ["same", "4h", "1d"];
export const PATTERN_TYPES: readonly PatternType[] = [
  "doubleBottom",
  "inverseHeadShoulders",
  "bullFlag",
  "bullishEngulfing",
  "hammer",
  "invertedHammer",
  "bullishHarami",
  "tweezersBottom",
  "threeWhiteSoldiers",
];

export const PRESET = { id: "v1", name: "Default", frozen: "2026-11-01" } as const;

export interface DetectionConfig {
  patterns: Record<PatternType, CandleInterval[]>;
  zones: ZoneSourceOption;
}

export const DEFAULT_DETECTION: DetectionConfig = {
  patterns: {
    doubleBottom: ["4h", "1d"],
    inverseHeadShoulders: ["4h", "1d"],
    bullFlag: ["1h", "4h"],
    bullishEngulfing: ["4h", "1d"],
    hammer: ["1h", "4h"],
    invertedHammer: ["4h"],
    bullishHarami: ["4h"],
    tweezersBottom: ["4h"],
    threeWhiteSoldiers: ["4h", "1d"],
  },
  zones: "1d",
};

const RANK: Record<string, number> = { "1h": 1, "4h": 2, "1d": 3 };

/** Zones never come from a lower timeframe than the pattern's. */
export function zoneTfFor(patternTf: CandleInterval, option: ZoneSourceOption): CandleInterval {
  if (option === "same") return patternTf;
  return RANK[option] > RANK[patternTf] ? option : patternTf;
}

/** Every pattern timeframe in use, ascending. */
export function activeTfs(cfg: DetectionConfig): CandleInterval[] {
  const set = new Set(PATTERN_TYPES.flatMap((p) => cfg.patterns[p]));
  return DETECTION_TFS.filter((tf) => set.has(tf));
}

export const DETECTION_STORAGE_KEY = "detection:config";

export function parseDetection(value: unknown): DetectionConfig {
  const v = (typeof value === "object" && value !== null ? value : {}) as {
    patterns?: Record<string, unknown>;
    zones?: unknown;
  };
  const patterns = { ...DEFAULT_DETECTION.patterns };
  for (const p of PATTERN_TYPES) {
    const raw = v.patterns?.[p];
    if (Array.isArray(raw)) patterns[p] = DETECTION_TFS.filter((tf) => raw.includes(tf));
  }
  const zones = ZONE_OPTIONS.find((z) => z === v.zones) ?? DEFAULT_DETECTION.zones;
  return { patterns, zones };
}

export function loadDetection(): DetectionConfig {
  try {
    const raw = localStorage.getItem(DETECTION_STORAGE_KEY);
    return parseDetection(raw ? JSON.parse(raw) : null);
  } catch {
    return DEFAULT_DETECTION;
  }
}

export function saveDetection(cfg: DetectionConfig): void {
  try {
    localStorage.setItem(DETECTION_STORAGE_KEY, JSON.stringify(cfg));
  } catch {
    // storage blocked: the choice lasts for this session only
  }
}
