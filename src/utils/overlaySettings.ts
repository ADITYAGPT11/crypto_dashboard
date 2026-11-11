/**
 * What the chart draws from the analysis, chosen by the user and saved in this browser.
 *
 * Display only: these choices pick which detected levels and tags are SHOWN. They never
 * change a rule or a statistic (setups are still located against every level).
 *
 * "Key" levels by default: intact, strong, not overlapping a stronger one, and only the
 * nearest few of each kind to the current price.
 */
import type { FairValueGap, OrderBlock, Zone } from "../types/analysis";

export interface OverlaySettings {
  pattern: boolean;
  zones: boolean;
  orderBlocks: boolean;
  fvg: boolean;
  vp: boolean;
  heatmap: boolean;
  /** Text labels on zones and blocks. */
  labels: boolean;
  /** Nearest levels of each kind shown (demand, supply, bullish OB, bearish OB, each FVG side). */
  perKind: number;
  /** Zones need at least this departure, in ATR. */
  minZoneAtr: number;
  /** Only untested zones and unmitigated blocks. */
  freshOnly: boolean;
  /** Where two levels of the same kind overlap, draw only the stronger. */
  mergeOverlaps: boolean;
  /** Also draw the most recently broken levels (faint). */
  showBroken: boolean;
  /** Tags for other recent patterns besides the selected one. */
  patternTags: number;
}

export const DEFAULT_OVERLAYS: OverlaySettings = {
  pattern: true,
  zones: true,
  orderBlocks: true,
  fvg: false,
  vp: true,
  heatmap: false,
  labels: true,
  perKind: 2,
  minZoneAtr: 2,
  freshOnly: false,
  mergeOverlaps: true,
  showBroken: false,
  patternTags: 3,
};

export const PER_KIND_CHOICES = [1, 2, 3, 5, 10] as const;
export const ZONE_ATR_CHOICES = [1.5, 2, 3, 4] as const;
export const PATTERN_TAG_CHOICES = [0, 3, 5, 12] as const;
export const OVERLAYS_STORAGE_KEY = "chart:overlays";

const pick = <T extends number>(choices: readonly T[], v: unknown, fallback: T): T =>
  choices.find((c) => c === v) ?? fallback;

export function parseOverlays(value: unknown): OverlaySettings {
  const v = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  const flag = (k: keyof OverlaySettings) =>
    typeof v[k] === "boolean" ? (v[k] as boolean) : (DEFAULT_OVERLAYS[k] as boolean);
  return {
    pattern: flag("pattern"),
    zones: flag("zones"),
    orderBlocks: flag("orderBlocks"),
    fvg: flag("fvg"),
    vp: flag("vp"),
    heatmap: flag("heatmap"),
    labels: flag("labels"),
    perKind: pick(PER_KIND_CHOICES, v.perKind, 2),
    minZoneAtr: pick(ZONE_ATR_CHOICES, v.minZoneAtr, 2),
    freshOnly: flag("freshOnly"),
    mergeOverlaps: flag("mergeOverlaps"),
    showBroken: flag("showBroken"),
    patternTags: pick(PATTERN_TAG_CHOICES, v.patternTags, 3),
  };
}

export interface LevelSet {
  zones: Zone[];
  orderBlocks: OrderBlock[];
  fvgs: FairValueGap[];
}

interface Band {
  low: number;
  high: number;
}

const mid = (b: Band) => (b.low + b.high) / 2;
const overlaps = (a: Band, b: Band) => a.low <= b.high && b.low <= a.high;

/** Strongest first; drop any level overlapping one already kept. */
function dedupe<T extends Band>(items: T[], strength: (t: T) => number): T[] {
  const kept: T[] = [];
  for (const it of [...items].sort((a, b) => strength(b) - strength(a)))
    if (!kept.some((k) => overlaps(k, it))) kept.push(it);
  return kept;
}

function nearest<T extends Band>(items: T[], price: number, n: number): T[] {
  return [...items].sort((a, b) => Math.abs(mid(a) - price) - Math.abs(mid(b) - price)).slice(0, n);
}

function recentBroken<T>(items: T[], endOf: (t: T) => number | null, n: number): T[] {
  return items
    .filter((t) => endOf(t) !== null)
    .sort((a, b) => (endOf(b) ?? 0) - (endOf(a) ?? 0))
    .slice(0, n);
}

/** The levels to draw at `price` (last price) under the user's settings. */
export function keyLevels(all: LevelSet, price: number, s: OverlaySettings): LevelSet {
  const pick = <T extends Band & { kind: string }>(
    items: T[],
    kinds: readonly string[],
    ok: (t: T) => boolean,
    strength: (t: T) => number,
  ): T[] =>
    kinds.flatMap((kind) => {
      const live = items.filter((t) => t.kind === kind && ok(t));
      return nearest(s.mergeOverlaps ? dedupe(live, strength) : live, price, s.perKind);
    });

  const zones = pick(
    all.zones,
    ["demand", "supply"],
    (z) => z.endTime === null && z.departureAtr >= s.minZoneAtr && (!s.freshOnly || z.tests === 0),
    (z) => z.departureAtr,
  );
  const orderBlocks = pick(
    all.orderBlocks,
    ["bullish", "bearish"],
    (b) => b.endTime === null && (!s.freshOnly || b.mitigatedTime === null),
    (b) => b.formedTime, // the most recent block is the one price reacts to
  );
  const fvgs = pick(
    all.fvgs,
    ["bullish", "bearish"],
    (g) => g.filledTime === null,
    (g) => g.high - g.low,
  );
  if (!s.showBroken) return { zones, orderBlocks, fvgs };
  return {
    zones: [...zones, ...recentBroken(all.zones, (z) => z.endTime, s.perKind)],
    orderBlocks: [...orderBlocks, ...recentBroken(all.orderBlocks, (b) => b.endTime, s.perKind)],
    fvgs,
  };
}
