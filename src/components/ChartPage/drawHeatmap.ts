import type { Candle, CandleInterval } from "../../types/marketData";
import type { HeatmapFrame } from "../../utils/liquidityHeatmap";
import { TF_MS } from "../../utils/timeframeMapping";

/** Navy (thin) → amber (thick), Bookmap-style; alpha grows with size. */
function heat(t: number): string {
  const r = Math.round(27 + (240 - 27) * t);
  const g = Math.round(42 + (163 - 42) * t);
  const b = Math.round(74 + (94 - 74) * t);
  return `rgba(${r},${g},${b},${(0.15 + 0.7 * t).toFixed(3)})`;
}

/** Logical index of the bar opening at `time` (the forming bar is `candles.length`). */
function barIndex(candles: readonly Candle[], time: number, ms: number): number | null {
  if (candles.length === 0) return null;
  const first = candles[0].openTime;
  const last = candles[candles.length - 1].openTime;
  if (time < first) return null;
  if (time > last) return candles.length - 1 + Math.round((time - last) / ms);
  let lo = 0;
  let hi = candles.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (candles[mid].openTime === time) return mid;
    if (candles[mid].openTime < time) lo = mid + 1;
    else hi = mid - 1;
  }
  return null;
}

/**
 * Resting liquidity behind the candles: one column per bar since the page opened,
 * and the current book extended to the right edge so it shows on any timeframe.
 */
export function drawHeatmap(
  g: CanvasRenderingContext2D,
  frame: HeatmapFrame,
  candles: readonly Candle[],
  viewTf: CandleInterval,
  x: (logical: number) => number | null,
  y: (price: number) => number | null,
  plotW: number,
  h: number,
) {
  const ms = TF_MS[viewTf];
  const cell = (x1: number, x2: number, p: number, notional: number) => {
    const y1 = y(p + frame.bucket);
    const y2 = y(p);
    if (y1 === null || y2 === null || y2 < 0 || y1 > h) return;
    const t = Math.min(1, Math.sqrt(notional / frame.scale));
    if (t < 0.04) return;
    g.fillStyle = heat(t);
    g.fillRect(x1, y1, Math.max(1, x2 - x1), Math.max(1, y2 - y1));
  };
  let lastRight: number | null = null;
  for (const col of frame.columns) {
    const i = barIndex(candles, col.time, ms);
    if (i === null) continue;
    const x1 = x(i - 0.5);
    const x2 = x(i + 0.5);
    if (x1 === null || x2 === null || x2 < 0 || x1 > plotW) continue;
    for (const c of col.cells) cell(x1, x2, c.price, c.notional);
    lastRight = x2;
  }
  const latest = frame.columns[frame.columns.length - 1];
  if (latest) {
    const from = lastRight ?? plotW * 0.85;
    for (const c of latest.cells) cell(from, plotW, c.price, c.notional);
  }
}
