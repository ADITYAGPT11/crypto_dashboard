/**
 * Liquidity heatmap rendering, the way order-flow tools (Bookmap, TradingLite) draw it:
 *
 * - one column per book snapshot on the TIME axis (not averaged per candle), so the heat is
 *   just as sharp on a 4h chart as on a 1m one when zoomed in;
 * - bids and asks on one thermal scale (dark navy → blue → cyan → green → yellow → orange →
 *   red → white): colour is size, the price line shows which side is which;
 * - contrast from what is on screen: the brightest colour is a high percentile of the visible
 *   cells (adjustable), so one huge wall does not wash the rest out;
 * - drawn into a pixel buffer (ImageData) behind the candles, cheap enough to redraw on every
 *   scroll.
 *
 * Observation only: visible orders can be pulled or spoofed.
 */
import type { BookSample } from "./liquidityHeatmap";

export type HeatContrast = "low" | "normal" | "high";

/** Share of visible cells below the brightest colour, per contrast setting. */
export const CONTRAST_QUANTILE: Record<HeatContrast, number> = {
  low: 0.998,
  normal: 0.985,
  high: 0.94,
};

/** Thermal stops (t, r, g, b, alpha). Low sizes fade into the background. */
const STOPS: readonly [number, number, number, number, number][] = [
  [0, 8, 14, 40, 0],
  [0.06, 12, 22, 72, 110],
  [0.18, 22, 52, 150, 190],
  [0.32, 0, 140, 210, 220],
  [0.46, 0, 200, 170, 235],
  [0.6, 90, 215, 70, 245],
  [0.72, 245, 225, 50, 250],
  [0.84, 250, 140, 30, 255],
  [0.94, 235, 50, 35, 255],
  [1, 255, 245, 230, 255],
];

let lut: Uint8ClampedArray | null = null;

/** 256 RGBA entries interpolated between the thermal stops. */
export function heatPalette(): Uint8ClampedArray {
  if (lut) return lut;
  const out = new Uint8ClampedArray(256 * 4);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let j = 0;
    while (j < STOPS.length - 2 && t > STOPS[j + 1][0]) j++;
    const [t0, ...a] = STOPS[j];
    const [t1, ...b] = STOPS[j + 1];
    const f = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
    for (let c = 0; c < 4; c++) out[i * 4 + c] = Math.round(a[c] + (b[c] - a[c]) * f);
  }
  lut = out;
  return out;
}

/**
 * The notional that gets the brightest colour: the `q` quantile of the values, estimated on at
 * most `maxSample` of them (sorting every visible cell on each scroll is wasteful).
 */
export function contrastCut(values: readonly number[], q: number, maxSample = 20_000): number {
  if (values.length === 0) return 1;
  const step = Math.max(1, Math.floor(values.length / maxSample));
  const picked: number[] = [];
  for (let i = 0; i < values.length; i += step) picked.push(values[i]);
  picked.sort((x, y) => x - y);
  const v = picked[Math.min(picked.length - 1, Math.floor(q * picked.length))];
  return v > 0 ? v : 1;
}

/** Palette index of `notional` for brightest-at `cut`; a gentle gamma lifts mid sizes. */
export function heatIndex(notional: number, cut: number, gamma = 0.7): number {
  if (!(notional > 0) || !(cut > 0)) return 0;
  const t = Math.min(1, notional / cut);
  return Math.round(255 * t ** gamma);
}

export interface RasterInput {
  width: number;
  height: number;
  /** Ascending by time. */
  samples: readonly BookSample[];
  /** x pixel of a time, or null off the time axis. */
  xOf: (time: number) => number | null;
  /** y pixel of a price, or null. */
  yOf: (price: number) => number | null;
  contrast: HeatContrast;
  /** Time a sample lasts when the next one is far away or missing (ms). */
  defaultSpan?: number;
}

export interface Raster {
  data: Uint8ClampedArray<ArrayBuffer>;
  /** Notional drawn at full brightness. */
  cut: number;
  /** x where the last sample's column ends (the live edge), or null. */
  lastX: number | null;
}

/** Each sample lasts until the next one, but never more than 3 × its own span (gaps stay empty). */
function sampleEnd(s: BookSample, next: BookSample | undefined, fallback: number): number {
  const span = s.span ?? fallback;
  const own = s.time + span;
  return next ? Math.min(next.time, s.time + 3 * span) : own;
}

/** Rasterise the samples into an RGBA buffer of `width` × `height` CSS pixels. */
export function rasterizeHeatmap(input: RasterInput): Raster {
  const { width: w, height: h, samples, xOf, yOf, contrast, defaultSpan = 2_000 } = input;
  const data = new Uint8ClampedArray(Math.max(0, w * h * 4));
  // Columns on screen (x span) first, so the contrast only looks at what is visible.
  const cols: { s: BookSample; x1: number; x2: number }[] = [];
  let lastX: number | null = null;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const a = xOf(s.time);
    const b = xOf(sampleEnd(s, samples[i + 1], defaultSpan));
    if (a === null || b === null) continue;
    if (i === samples.length - 1) lastX = b;
    if (b < 0 || a > w) continue;
    cols.push({
      s,
      x1: Math.max(0, Math.floor(a)),
      x2: Math.min(w, Math.max(Math.floor(a) + 1, Math.ceil(b))),
    });
  }
  const values: number[] = [];
  for (const { s } of cols) {
    for (const v of s.bids.values()) values.push(v);
    for (const v of s.asks.values()) values.push(v);
  }
  const cut = contrastCut(values, CONTRAST_QUANTILE[contrast]);
  const pal = heatPalette();
  // Row spans per (bucket size, bucket index), shared by every column.
  const rows = new Map<string, [number, number] | null>();
  const rowOf = (bucket: number, k: number): [number, number] | null => {
    const key = `${bucket}|${k}`;
    let r = rows.get(key);
    if (r === undefined) {
      const top = yOf((k + 1) * bucket);
      const bottom = yOf(k * bucket);
      r =
        top === null || bottom === null
          ? null
          : [
              Math.max(0, Math.floor(Math.min(top, bottom))),
              Math.min(
                h,
                Math.max(Math.ceil(Math.max(top, bottom)), Math.floor(Math.min(top, bottom)) + 1),
              ),
            ];
      if (r && r[0] >= r[1]) r = null;
      rows.set(key, r);
    }
    return r;
  };
  for (const { s, x1, x2 } of cols) {
    for (const side of [s.bids, s.asks]) {
      for (const [k, v] of side) {
        const idx = heatIndex(v, cut);
        if (idx === 0) continue;
        const r = rowOf(s.bucket, k);
        if (!r) continue;
        const p = idx * 4;
        for (let y = r[0]; y < r[1]; y++) {
          let o = (y * w + x1) * 4;
          for (let x = x1; x < x2; x++, o += 4) {
            data[o] = pal[p];
            data[o + 1] = pal[p + 1];
            data[o + 2] = pal[p + 2];
            data[o + 3] = pal[p + 3];
          }
        }
      }
    }
  }
  return { data, cut, lastX };
}
