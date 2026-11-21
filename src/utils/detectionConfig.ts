/**
 * Which timeframes chart patterns are looked for on: one choice for every pattern,
 * independent of the chart's view timeframe. Zones and order blocks always come from
 * the pattern's own timeframe.
 *
 * Only chart patterns are shown; the backend still measures candlestick patterns and the
 * location / order-flow splits, they are just not part of the app's screens.
 * The rules themselves are the backend's versioned rule set (`ruleset` in the catalogue).
 */
import type { CatalogOut, PatternOut } from "../api/schema";
import type { CandleInterval } from "../types/marketData";

export const DETECTION_TFS: readonly CandleInterval[] = ["1h", "4h", "1d"];

export interface DetectionConfig {
  /** Timeframes chart patterns are looked for on, ascending. */
  tfs: CandleInterval[];
}

export const DEFAULT_DETECTION: DetectionConfig = { tfs: ["4h", "1d"] };

/** The patterns the app shows: chart patterns only. */
export function isShown(p: Pick<PatternOut, "kind"> | undefined): boolean {
  return p?.kind === "chart";
}

export function shownPatterns(catalog: CatalogOut | null | undefined): PatternOut[] {
  return (catalog?.patterns ?? []).filter(isShown);
}

/** Ids of the shown patterns (empty until the catalogue has loaded). */
export function shownIds(catalog: CatalogOut | null | undefined): Set<string> {
  return new Set(shownPatterns(catalog).map((p) => p.id));
}

export const DETECTION_STORAGE_KEY = "detection:config";

/** Stored value from untrusted storage; the older per-pattern form falls back to the default. */
export function parseDetection(value: unknown): DetectionConfig {
  const v = (typeof value === "object" && value !== null ? value : {}) as { tfs?: unknown };
  if (!Array.isArray(v.tfs)) return DEFAULT_DETECTION;
  const raw: unknown[] = v.tfs;
  return { tfs: DETECTION_TFS.filter((tf) => raw.includes(tf)) };
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

/** Turn one timeframe on or off, keeping the list in DETECTION_TFS order. */
export function toggleTf(cfg: DetectionConfig, tf: CandleInterval): DetectionConfig {
  const on = cfg.tfs.includes(tf);
  return { tfs: DETECTION_TFS.filter((x) => (x === tf ? !on : cfg.tfs.includes(x))) };
}
