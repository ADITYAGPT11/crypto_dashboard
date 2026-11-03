import { describe, expect, it } from "vite-plus/test";
import type { Candle } from "../../types/marketData";
import type { PatternHit } from "../../types/analysis";
import { detectBullFlags, detectInverseHeadShoulders } from "../patterns";

const H = 3_600_000;

/** Path through (index, price) waypoints; each candle spans ±0.5 around a straight walk. */
function path(points: [number, number][]): Candle[] {
  const out: Candle[] = [];
  for (let k = 1; k < points.length; k++) {
    const [i0, p0] = points[k - 1];
    const [i1, p1] = points[k];
    for (let i = i0; i < i1; i++) {
      const open = p0 + ((p1 - p0) * (i - i0)) / (i1 - i0);
      const close = p0 + ((p1 - p0) * (i + 1 - i0)) / (i1 - i0);
      out.push({
        openTime: i * H,
        open,
        close,
        high: Math.max(open, close) + 0.5,
        low: Math.min(open, close) - 0.5,
        volume: 100,
      });
    }
  }
  return out;
}

/** The same hit is found with only the candles up to its confirmation. */
function noLookAhead(detect: (c: Candle[]) => PatternHit[], candles: Candle[]) {
  const full = detect(candles);
  for (const h of full) {
    const prefix = detect(candles.slice(0, h.index + 1));
    expect(prefix.some((p) => p.index === h.index && p.entry === h.entry)).toBe(true);
  }
  return full;
}

describe("inverse head and shoulders", () => {
  // decline, left shoulder 90, peak 96, head 84, peak 96.5, right shoulder 90.5, breakout to 100
  const ihs = path([
    [0, 104],
    [20, 90],
    [28, 96],
    [38, 84],
    [48, 96.5],
    [56, 90.5],
    [70, 100],
    [80, 99],
  ]);

  it("confirms on the close above the neckline with a measured-move target", () => {
    const hits = noLookAhead(detectInverseHeadShoulders, ihs);
    expect(hits).toHaveLength(1);
    const h = hits[0];
    expect(h.type).toBe("inverseHeadShoulders");
    expect(h.index).toBeGreaterThan(56 + 3);
    expect(h.low).toBeCloseTo(83.5, 6); // head low
    expect(h.stop).toBeLessThan(90); // below the right shoulder
    expect(h.target).toBeGreaterThan(h.line!.to.price + 10); // neckline + head depth
    expect(h.entry).toBeGreaterThan(h.line!.to.price); // closed above the neckline
    expect(h.points).toHaveLength(6);
  });

  it("does not fire when the head is not lower than the shoulders", () => {
    const flat = path([
      [0, 104],
      [20, 90],
      [28, 96],
      [38, 90.2],
      [48, 96.5],
      [56, 90.5],
      [70, 100],
    ]);
    expect(detectInverseHeadShoulders(flat)).toHaveLength(0);
  });

  it("does not fire without a neckline break", () => {
    const noBreak = path([
      [0, 104],
      [20, 90],
      [28, 96],
      [38, 84],
      [48, 96.5],
      [56, 90.5],
      [70, 94],
      [85, 92],
    ]);
    expect(detectInverseHeadShoulders(noBreak)).toHaveLength(0);
  });

  it("fails when price closes below the right shoulder before breaking out", () => {
    const failed = path([
      [0, 104],
      [20, 90],
      [28, 96],
      [38, 84],
      [48, 96.5],
      [56, 90.5],
      [61, 92],
      [64, 88],
      [80, 100],
    ]);
    expect(detectInverseHeadShoulders(failed).filter((h) => h.index > 56)).toHaveLength(0);
  });
});

describe("bull flag", () => {
  // flat base, pole 100 → 112 in 6 candles, flag drifting to 109, breakout to 114
  const flag = path([
    [0, 100],
    [20, 100.2],
    [26, 112],
    [32, 109],
    [35, 114],
    [45, 115],
  ]);

  it("confirms on the close above the flag with a pole-height target", () => {
    const hits = noLookAhead(detectBullFlags, flag);
    expect(hits).toHaveLength(1);
    const h = hits[0];
    expect(h.type).toBe("bullFlag");
    expect(h.index).toBeGreaterThanOrEqual(26 + 4);
    expect(h.entry).toBeGreaterThan(h.line!.from.price);
    expect(h.stop).toBeLessThan(h.low);
    expect(h.target - h.entry).toBeCloseTo(h.points[1].price - h.points[0].price, 6);
  });

  it("does not fire when the flag gives back more than half the pole", () => {
    const deep = path([
      [0, 100],
      [20, 100.2],
      [26, 112],
      [32, 104],
      [35, 114],
    ]);
    expect(detectBullFlags(deep)).toHaveLength(0);
  });

  it("does not fire without a real pole", () => {
    const weak = path([
      [0, 100],
      [20, 100.2],
      [26, 102],
      [32, 101],
      [35, 103],
    ]);
    expect(detectBullFlags(weak)).toHaveLength(0);
  });
});
