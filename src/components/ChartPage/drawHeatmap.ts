import type { BookSample } from "../../utils/liquidityHeatmap";
import { rasterizeHeatmap, type HeatContrast } from "../../utils/heatmapRender";

/**
 * The liquidity heatmap on its own canvas BEHIND the candles: one column per book snapshot
 * on the time axis, thermal colours, contrast from what is visible. Returns where the live
 * edge (the last snapshot's column) ends, for the depth profile.
 */
export function drawHeatmap(
  canvas: HTMLCanvasElement,
  samples: readonly BookSample[],
  xOf: (time: number) => number | null,
  yOf: (price: number) => number | null,
  width: number,
  height: number,
  contrast: HeatContrast,
): number | null {
  // One canvas pixel per CSS pixel: a heatmap gains nothing from device resolution and the
  // buffer stays small enough to rebuild on every scroll.
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  const g = canvas.getContext("2d");
  if (!g) return null;
  if (samples.length === 0) {
    g.clearRect(0, 0, w, h);
    return null;
  }
  const r = rasterizeHeatmap({ width: w, height: h, samples, xOf, yOf, contrast });
  g.putImageData(new ImageData(r.data, w, h), 0, 0);
  return r.lastX;
}

export function clearHeatmap(canvas: HTMLCanvasElement | null) {
  canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
}

/**
 * The current book as horizontal bars at the right edge (bids green, asks red), length ∝
 * resting notional, like a DOM's depth column. Drawn above the candles.
 */
export function drawDepthProfile(
  g: CanvasRenderingContext2D,
  latest: BookSample,
  yOf: (price: number) => number | null,
  right: number,
  h: number,
) {
  const width = Math.min(90, Math.max(40, right * 0.1));
  let max = 0;
  for (const v of latest.bids.values()) max = Math.max(max, v);
  for (const v of latest.asks.values()) max = Math.max(max, v);
  if (max <= 0) return;
  g.save();
  for (const [side, m] of [
    ["bid", latest.bids],
    ["ask", latest.asks],
  ] as const) {
    g.fillStyle = side === "bid" ? "rgba(86,211,100,0.55)" : "rgba(244,112,103,0.55)";
    for (const [k, v] of m) {
      const top = yOf((k + 1) * latest.bucket);
      const bottom = yOf(k * latest.bucket);
      if (top === null || bottom === null || bottom < 0 || top > h) continue;
      const len = (v / max) * width;
      g.fillRect(right - len, top, len, Math.max(1, bottom - top - 0.5));
    }
  }
  g.restore();
}
