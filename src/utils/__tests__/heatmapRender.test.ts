import { describe, expect, it } from "vite-plus/test";
import type { BookSample } from "../liquidityHeatmap";
import { contrastCut, heatIndex, heatPalette, rasterizeHeatmap } from "../heatmapRender";

const sample = (
  time: number,
  bids: [number, number][],
  asks: [number, number][] = [],
  span = 1_000,
): BookSample => ({ time, span, mid: 0, bucket: 1, bids: new Map(bids), asks: new Map(asks) });

/** 1 px per second from t = 0; 1 px per price unit, price 0 at the bottom of a 10-px canvas. */
const xOf = (t: number) => t / 1_000;
const yOf = (p: number) => 10 - p;
const alphaAt = (data: Uint8ClampedArray, w: number, x: number, y: number) =>
  data[(y * w + x) * 4 + 3];

describe("heatmap render", () => {
  it("palette fades in from transparent and ends near white", () => {
    const p = heatPalette();
    expect(p.length).toBe(1024);
    expect(p[3]).toBe(0);
    expect([p[1020], p[1021], p[1022], p[1023]]).toEqual([255, 245, 230, 255]);
  });

  it("maps size to brightness against the contrast cut", () => {
    expect(heatIndex(0, 100)).toBe(0);
    expect(heatIndex(100, 100)).toBe(255);
    expect(heatIndex(1e9, 100)).toBe(255);
    expect(heatIndex(50, 100)).toBeGreaterThan(127); // gamma lifts mid sizes
    expect(contrastCut([1, 2, 3, 4, 100], 0.8)).toBe(100);
    expect(contrastCut([], 0.9)).toBe(1);
  });

  it("draws one column per snapshot at its time and price row", () => {
    const r = rasterizeHeatmap({
      width: 10,
      height: 10,
      samples: [sample(2_000, [[5, 100]]), sample(3_000, [[5, 100]], [[7, 50]])],
      xOf,
      yOf,
      contrast: "normal",
    });
    // Bucket 5 spans prices 5..6 → y 4..5; columns x 2 and 3.
    expect(alphaAt(r.data, 10, 2, 4)).toBeGreaterThan(0);
    expect(alphaAt(r.data, 10, 3, 4)).toBeGreaterThan(0);
    expect(alphaAt(r.data, 10, 1, 4)).toBe(0);
    expect(alphaAt(r.data, 10, 4, 4)).toBe(0); // the last snapshot lasts its own span only
    expect(alphaAt(r.data, 10, 2, 5)).toBe(0); // no liquidity one row lower
    expect(alphaAt(r.data, 10, 3, 2)).toBeGreaterThan(0); // the ask at 7 → y 2..3
    expect(r.lastX).toBe(4);
  });

  it("leaves gaps empty instead of stretching an old snapshot", () => {
    const r = rasterizeHeatmap({
      width: 20,
      height: 10,
      samples: [sample(0, [[5, 100]]), sample(15_000, [[5, 100]])],
      xOf,
      yOf,
      contrast: "normal",
    });
    expect(alphaAt(r.data, 20, 2, 4)).toBeGreaterThan(0); // up to 3 × its span
    expect(alphaAt(r.data, 20, 8, 4)).toBe(0);
    expect(alphaAt(r.data, 20, 15, 4)).toBeGreaterThan(0);
  });

  it("only what is on screen sets the contrast", () => {
    const off = sample(-50_000, [[5, 1_000_000]]);
    const on = sample(1_000, [[5, 100]]);
    const r = rasterizeHeatmap({
      width: 10,
      height: 10,
      samples: [off, on],
      xOf,
      yOf,
      contrast: "normal",
    });
    expect(r.cut).toBe(100);
  });
});
