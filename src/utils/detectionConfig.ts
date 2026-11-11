/**
 * Which timeframes each pattern is detected on and where zones come from.
 * Chosen by the user; independent of the chart's view timeframe.
 *
 * These pick between setups that are each measured separately (a 4h double
 * bottom at 1d zones has its own statistics), so they never tune a rule. The
 * rules themselves are the backend's versioned rule set (`ruleset` in the catalogue).
 */
import type { CatalogOut, PatternOut } from "../api/schema";
import type { CandleInterval } from "../types/marketData";
import type { PatternId } from "../types/analysis";

export const DETECTION_TFS: readonly CandleInterval[] = ["1h", "4h", "1d"];
export type ZoneSourceOption = "same" | "4h" | "1d";
export const ZONE_OPTIONS: readonly ZoneSourceOption[] = ["same", "4h", "1d"];

export interface DetectionConfig {
  /** Timeframes per pattern id; patterns not listed use their kind's default. */
  patterns: Record<PatternId, CandleInterval[]>;
  zones: ZoneSourceOption;
}

export const DEFAULT_TFS: Record<PatternOut["kind"], readonly CandleInterval[]> = {
  chart: ["4h", "1d"],
  candlestick: ["4h"],
};

export const DEFAULT_DETECTION: DetectionConfig = { patterns: {}, zones: "1d" };

const RANK: Record<string, number> = { "1h": 1, "4h": 2, "1d": 3 };

/** Zones never come from a lower timeframe than the pattern's. */
export function zoneTfFor(patternTf: CandleInterval, option: ZoneSourceOption): CandleInterval {
  if (option === "same") return patternTf;
  return RANK[option] > RANK[patternTf] ? option : patternTf;
}

export function tfsFor(cfg: DetectionConfig, p: Pick<PatternOut, "id" | "kind">): CandleInterval[] {
  return cfg.patterns[p.id] ?? [...DEFAULT_TFS[p.kind]];
}

/** Every pattern timeframe in use, ascending. */
export function activeTfs(cfg: DetectionConfig, catalog: CatalogOut | null): CandleInterval[] {
  const set = new Set((catalog?.patterns ?? []).flatMap((p) => tfsFor(cfg, p)));
  return DETECTION_TFS.filter((tf) => set.has(tf));
}

export const DETECTION_STORAGE_KEY = "detection:config";
const PATTERN_ID = /^[a-zA-Z][a-zA-Z0-9]{1,40}$/;

export function parseDetection(value: unknown): DetectionConfig {
  const v = (typeof value === "object" && value !== null ? value : {}) as {
    patterns?: Record<string, unknown>;
    zones?: unknown;
  };
  const patterns: Record<PatternId, CandleInterval[]> = {};
  for (const [id, raw] of Object.entries(v.patterns ?? {})) {
    if (PATTERN_ID.test(id) && Array.isArray(raw))
      patterns[id] = DETECTION_TFS.filter((tf) => raw.includes(tf));
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
