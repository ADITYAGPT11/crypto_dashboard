/**
 * What the app looks for: the timeframes patterns are found on, and which patterns (per
 * direction) are shown. One choice for every screen, saved per browser; independent of the
 * chart's view timeframe. Zones and order blocks always come from the pattern's own timeframe.
 *
 * Chart patterns are on and candlestick patterns off until the user picks. The backend detects
 * and measures every pattern regardless, so these choices never change a statistic.
 * The rules themselves are the backend's versioned rule set (`ruleset` in the catalogue).
 */
import type { CatalogOut, PatternOut } from "../api/schema";
import type { CandleInterval } from "../types/marketData";

export const DETECTION_TFS: readonly CandleInterval[] = ["15m", "1h", "4h", "1d"];

export type PickDirection = "long" | "short";

export interface DetectionConfig {
  /** Timeframes patterns are looked for on, ascending. */
  tfs: CandleInterval[];
  /** Explicit choices per `pattern|direction`; missing keys use the kind's default. */
  picks: Record<string, boolean>;
}

export const DEFAULT_DETECTION: DetectionConfig = { tfs: ["4h", "1d"], picks: {} };

export function pickKey(pattern: string, direction: PickDirection): string {
  return `${pattern}|${direction}`;
}

/** One line of the pattern menu: a pattern in one direction. */
export interface PatternOption {
  key: string;
  id: string;
  kind: PatternOut["kind"];
  direction: PickDirection;
  label: string;
}

export function directionsOf(p: Pick<PatternOut, "bias">): PickDirection[] {
  return p.bias === "either" ? ["long", "short"] : [p.bias];
}

/** Every pattern × direction the catalogue supports, in catalogue order. */
export function patternOptions(catalog: CatalogOut | null | undefined): PatternOption[] {
  return (catalog?.patterns ?? []).flatMap((p) =>
    directionsOf(p).map((direction) => ({
      key: pickKey(p.id, direction),
      id: p.id,
      kind: p.kind,
      direction,
      label: p.bias === "either" ? `${p.label} (${direction === "long" ? "up" : "down"})` : p.label,
    })),
  );
}

export function isPicked(cfg: DetectionConfig, o: Pick<PatternOption, "key" | "kind">): boolean {
  return cfg.picks[o.key] ?? o.kind === "chart";
}

/** Keys (`pattern|direction`) currently shown; empty until the catalogue has loaded. */
export function pickedKeys(cfg: DetectionConfig, catalog: CatalogOut | null | undefined) {
  return new Set(
    patternOptions(catalog)
      .filter((o) => isPicked(cfg, o))
      .map((o) => o.key),
  );
}

/** Turn several menu lines on or off at once (one line, or a whole section). */
export function setPicks(cfg: DetectionConfig, keys: string[], on: boolean): DetectionConfig {
  const picks = { ...cfg.picks };
  for (const k of keys) picks[k] = on;
  return { ...cfg, picks };
}

/** Turn one timeframe on or off, keeping the list in DETECTION_TFS order. */
export function toggleTf(cfg: DetectionConfig, tf: CandleInterval): DetectionConfig {
  const on = cfg.tfs.includes(tf);
  return { ...cfg, tfs: DETECTION_TFS.filter((x) => (x === tf ? !on : cfg.tfs.includes(x))) };
}

export const DETECTION_STORAGE_KEY = "detection:config";
const PICK_KEY = /^[a-zA-Z][a-zA-Z0-9]{1,40}\|(long|short)$/;

/** Stored value from untrusted storage; unknown shapes fall back to the default. */
export function parseDetection(value: unknown): DetectionConfig {
  const v = (typeof value === "object" && value !== null ? value : {}) as {
    tfs?: unknown;
    picks?: unknown;
  };
  if (!Array.isArray(v.tfs)) return DEFAULT_DETECTION;
  const raw: unknown[] = v.tfs;
  const picks: Record<string, boolean> = {};
  if (typeof v.picks === "object" && v.picks !== null) {
    for (const [k, on] of Object.entries(v.picks)) {
      if (PICK_KEY.test(k) && typeof on === "boolean") picks[k] = on;
    }
  }
  return { tfs: DETECTION_TFS.filter((tf) => raw.includes(tf)), picks };
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
