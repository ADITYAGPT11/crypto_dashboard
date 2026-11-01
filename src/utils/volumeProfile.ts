import type { Candle } from "../types/marketData";
import type { VolumeProfile } from "../types/analysis";

const VALUE_AREA_SHARE = 0.7;

/**
 * Volume-by-price over a set of candles. Each candle's volume is spread evenly
 * across the price bins its high–low range covers (we have no tick data).
 *
 * - POC: the bin with the most volume.
 * - Value area: grown from the POC, adding the heavier neighbour each step,
 *   until it holds 70% of all volume. VAH/VAL are its upper/lower edges.
 * - HVN: local volume peaks (±2 bins) above the mean, excluding the POC.
 * - LVN: local volume troughs (±1 bin) inside the value area.
 */
export function computeVolumeProfile(candles: Candle[], bins = 48): VolumeProfile | null {
  if (candles.length === 0 || bins < 3) return null;
  let low = Infinity;
  let high = -Infinity;
  for (const c of candles) {
    if (c.low < low) low = c.low;
    if (c.high > high) high = c.high;
  }
  if (!(high > low)) return null;

  const binSize = (high - low) / bins;
  const volumes: number[] = Array.from({ length: bins }, () => 0);
  const binOf = (price: number) => Math.min(bins - 1, Math.max(0, Math.floor((price - low) / binSize)));

  for (const c of candles) {
    const b0 = binOf(c.low);
    const b1 = binOf(c.high);
    const share = c.volume / (b1 - b0 + 1);
    for (let b = b0; b <= b1; b++) volumes[b] += share;
  }

  const total = volumes.reduce((s, v) => s + v, 0);
  let pocIndex = 0;
  for (let b = 1; b < bins; b++) if (volumes[b] > volumes[pocIndex]) pocIndex = b;

  let lo = pocIndex;
  let hi = pocIndex;
  let inArea = volumes[pocIndex];
  while (inArea < total * VALUE_AREA_SHARE && (lo > 0 || hi < bins - 1)) {
    const below = lo > 0 ? volumes[lo - 1] : -1;
    const above = hi < bins - 1 ? volumes[hi + 1] : -1;
    if (above >= below) {
      hi++;
      inArea += above;
    } else {
      lo--;
      inArea += below;
    }
  }

  const centre = (b: number) => low + (b + 0.5) * binSize;
  const avg = total / bins;

  const hvnBins: number[] = [];
  for (let b = 2; b < bins - 2; b++) {
    if (b === pocIndex) continue;
    const v = volumes[b];
    if (v > avg && v > volumes[b - 1] && v > volumes[b + 1] && v >= volumes[b - 2] && v >= volumes[b + 2]) {
      hvnBins.push(b);
    }
  }
  hvnBins.sort((a, b) => volumes[b] - volumes[a]);

  const lvnBins: number[] = [];
  for (let b = Math.max(1, lo + 1); b <= Math.min(bins - 2, hi - 1); b++) {
    if (volumes[b] < volumes[b - 1] && volumes[b] < volumes[b + 1]) lvnBins.push(b);
  }
  lvnBins.sort((a, b) => volumes[a] - volumes[b]);

  return {
    low,
    high,
    binSize,
    volumes,
    pocIndex,
    pocPrice: centre(pocIndex),
    vahPrice: low + (hi + 1) * binSize,
    valPrice: low + lo * binSize,
    hvn: hvnBins.slice(0, 2).map(centre),
    lvn: lvnBins.slice(0, 2).map(centre),
  };
}
