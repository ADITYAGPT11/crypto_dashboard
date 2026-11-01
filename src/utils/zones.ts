import type { Candle } from "../types/marketData";
import type { Zone } from "../types/analysis";
import { atr, sma } from "./indicators";

export interface ZoneOptions {
  /** Impulse candle range must be at least this many ATRs. */
  impulseAtr: number;
  /** Impulse body must be at least this share of its range. */
  impulseBody: number;
  /** Impulse volume must be at least this multiple of the 20-candle average. */
  impulseVolume: number;
  /** Minimum zone height in ATRs (thin base candles are padded). */
  minHeightAtr: number;
}

export const DEFAULT_ZONE_OPTIONS: ZoneOptions = {
  impulseAtr: 1.8,
  impulseBody: 0.6,
  impulseVolume: 1.3,
  minHeightAtr: 0.25,
};

/**
 * Supply/demand zones: the base candle right before an impulsive move
 * (large range, strong body, above-average volume).
 *
 * - Demand: base before a bullish impulse; zone = base low → top of base body.
 * - Supply: base before a bearish impulse; zone = bottom of base body → base high.
 *
 * Lifecycle (walks forward from the impulse, one candle at a time):
 * - A test starts when price trades back into the zone.
 * - The zone holds that test if a candle then closes back outside on the
 *   original side; it breaks (endIndex set) on a close through the far edge.
 */
export function detectZones(candles: Candle[], options: Partial<ZoneOptions> = {}): Zone[] {
  const o = { ...DEFAULT_ZONE_OPTIONS, ...options };
  const atrs = atr(candles, 14);
  const avgVol = sma(
    candles.map((c) => c.volume),
    20,
  );
  const zones: Zone[] = [];

  for (let i = 21; i < candles.length; i++) {
    const c = candles[i];
    const base = candles[i - 1];
    const a = atrs[i - 1];
    const v = avgVol[i - 1];
    if (!Number.isFinite(a) || !Number.isFinite(v) || a <= 0) continue;
    const range = c.high - c.low;
    const body = Math.abs(c.close - c.open);
    const impulsive =
      range >= o.impulseAtr * a && body >= o.impulseBody * range && c.volume >= o.impulseVolume * v;
    if (!impulsive) continue;

    const kind: Zone["kind"] = c.close > c.open ? "demand" : "supply";
    let low: number;
    let high: number;
    if (kind === "demand") {
      low = base.low;
      high = Math.max(base.open, base.close, low + o.minHeightAtr * a);
    } else {
      high = base.high;
      low = Math.min(base.open, base.close, high - o.minHeightAtr * a);
    }

    // Skip a zone that overlaps an intact zone of the same kind formed recently.
    const duplicate = zones.some(
      (z) =>
        z.kind === kind &&
        z.endIndex === null &&
        i - z.formedIndex <= 10 &&
        z.low <= high &&
        low <= z.high,
    );
    if (duplicate) continue;

    zones.push(trackZone(candles, { kind, low, high, startIndex: i - 1, formedIndex: i }));
  }
  return zones;
}

function trackZone(
  candles: Candle[],
  z: Pick<Zone, "kind" | "low" | "high" | "startIndex" | "formedIndex">,
): Zone {
  let tests = 0;
  let held = 0;
  let endIndex: number | null = null;
  let inside = false;

  for (let j = z.formedIndex + 1; j < candles.length; j++) {
    const c = candles[j];
    const entered = z.kind === "demand" ? c.low <= z.high : c.high >= z.low;
    if (!inside && entered) {
      inside = true;
      tests++;
    }
    if (!inside) continue;
    const broke = z.kind === "demand" ? c.close < z.low : c.close > z.high;
    if (broke) {
      endIndex = j;
      break;
    }
    const leftOnOriginalSide = z.kind === "demand" ? c.close > z.high : c.close < z.low;
    if (leftOnOriginalSide) {
      held++;
      inside = false;
    }
  }
  return { ...z, tests, held, endIndex };
}

/** Zones of a kind that existed and were intact at candle `index`. */
export function activeZonesAt(zones: Zone[], index: number, kind: Zone["kind"]): Zone[] {
  return zones.filter(
    (z) => z.kind === kind && z.formedIndex < index && (z.endIndex === null || z.endIndex > index),
  );
}
