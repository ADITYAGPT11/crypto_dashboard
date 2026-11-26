import { describe, expect, it } from "vite-plus/test";
import { candleSpan, isChartPattern, patternFigure } from "../patternGeometry";
import type { ViewPattern } from "../timeframeMapping";

function view(partial: Partial<ViewPattern>): ViewPattern {
  return {
    pattern: "doubleBottom",
    direction: "long",
    tf: "4h",
    points: [],
    blocks: [{ from: 29.5, to: 30.5 }],
    entryX: 30.5,
    startX: 9.5,
    lines: [],
    score: 3,
    checks: [],
    extreme: 90,
    close: 106,
    ...partial,
  };
}

const doubleBottom = view({
  points: [
    { x: 10, price: 90, label: "Bottom 1" },
    { x: 20, price: 105, label: "Peak" },
    { x: 26, price: 91, label: "Bottom 2" },
  ],
  lines: [{ x1: 20, p1: 105, x2: 30, p2: 105, label: "Neckline" }],
});

describe("patternFigure", () => {
  it("draws a double bottom as a W closed by its neckline", () => {
    const f = patternFigure(doubleBottom);
    expect(f.fill[0]).toEqual({ x: 5, price: 105 }); // half a leg before the first bottom
    expect(f.fill.slice(1, 4).map((p) => p.price)).toEqual([90, 105, 91]);
    expect(f.fill[4]).toEqual({ x: 30, price: 105 }); // back on the neckline at the breakout
    expect(f.labels).toEqual([
      { at: { x: 10, price: 90 }, text: "B1", side: "below" },
      { at: { x: 26, price: 91 }, text: "B2", side: "below" },
    ]);
    expect(f.height).toEqual({ from: { x: 10, price: 90 }, to: { x: 10, price: 105 } });
    expect(f.breakout).toEqual({ x: 30, price: 106 });
  });

  it("follows a sloped neckline (head and shoulders) and tags LS / H / RS", () => {
    const f = patternFigure(
      view({
        pattern: "inverseHeadShoulders",
        points: [
          { x: 8, price: 95, label: "Left shoulder" },
          { x: 12, price: 100, label: "" },
          { x: 16, price: 90, label: "Head" },
          { x: 20, price: 102, label: "" },
          { x: 24, price: 96, label: "Right shoulder" },
        ],
        lines: [{ x1: 12, p1: 100, x2: 30, p2: 109, label: "Neckline" }],
      }),
    );
    expect(f.labels.map((l) => l.text)).toEqual(["LS", "H", "RS"]);
    expect(f.fill[0]).toEqual({ x: 6, price: 97 }); // the neckline extended left
    expect(f.height).toEqual({ from: { x: 16, price: 90 }, to: { x: 16, price: 102 } });
  });

  it("puts a short pattern's tags above its highs", () => {
    const f = patternFigure(
      view({
        pattern: "doubleTop",
        direction: "short",
        points: [
          { x: 10, price: 110, label: "Top 1" },
          { x: 20, price: 95, label: "Trough" },
          { x: 26, price: 109, label: "Top 2" },
        ],
        lines: [{ x1: 20, p1: 95, x2: 30, p2: 95, label: "Neckline" }],
      }),
    );
    expect(f.labels.map((l) => [l.text, l.side])).toEqual([
      ["T1", "above"],
      ["T2", "above"],
    ]);
    expect(f.height?.from).toEqual({ x: 10, price: 110 });
  });

  it("shades a triangle between its trendlines and measures the height at its start", () => {
    const f = patternFigure(
      view({
        pattern: "ascendingTriangle",
        points: [
          { x: 10, price: 110, label: "" },
          { x: 14, price: 100, label: "" },
          { x: 20, price: 110.2, label: "" },
          { x: 24, price: 104, label: "" },
        ],
        lines: [
          { x1: 10, p1: 110, x2: 30, p2: 110.3, label: "Upper" },
          { x1: 10, p1: 98, x2: 30, p2: 107, label: "Lower" },
        ],
      }),
    );
    expect(f.fill).toEqual([
      { x: 10, price: 110 },
      { x: 30, price: 110.3 },
      { x: 30, price: 107 },
      { x: 10, price: 98 },
    ]);
    expect(f.dots).toHaveLength(4);
    expect(f.height).toEqual({ from: { x: 10, price: 98 }, to: { x: 10, price: 110 } });
  });

  it("draws a flag as a pole and a box over the pause", () => {
    const f = patternFigure(
      view({
        pattern: "bullFlag",
        points: [
          { x: 10, price: 90, label: "Pole" },
          { x: 15, price: 110, label: "Top" },
          { x: 22, price: 102, label: "Flag low" },
        ],
        lines: [{ x1: 16, p1: 108, x2: 30, p2: 108, label: "Flag high" }],
      }),
    );
    expect(f.strokes[0]).toEqual({
      pts: [
        { x: 10, price: 90 },
        { x: 15, price: 110 },
      ],
      width: 3,
    });
    expect(f.fill.map((p) => p.price)).toEqual([108, 108, 102, 102]);
    expect(f.fill.map((p) => p.x)).toEqual([15, 30, 30, 15]);
  });

  it("draws a pennant as a pole and its two converging lines", () => {
    const f = patternFigure(
      view({
        pattern: "bullPennant",
        points: [
          { x: 10, price: 90, label: "Pole" },
          { x: 16, price: 112, label: "Top" },
        ],
        lines: [
          { x1: 17, p1: 112, x2: 23, p2: 109.5, label: "Upper" },
          { x1: 17, p1: 107, x2: 23, p2: 109.5, label: "Lower" },
        ],
      }),
    );
    expect(f.strokes[0]).toEqual({
      pts: [
        { x: 10, price: 90 },
        { x: 16, price: 112 },
      ],
      width: 3,
    });
    expect(f.fill).toHaveLength(4);
    expect(f.dots).toEqual([]);
  });

  it("measures a rectangle's height", () => {
    const f = patternFigure(
      view({
        pattern: "rectangle",
        points: [{ x: 12, price: 110, label: "" }],
        lines: [
          { x1: 8, p1: 110, x2: 30, p2: 110, label: "Upper" },
          { x1: 8, p1: 100, x2: 30, p2: 100, label: "Lower" },
        ],
      }),
    );
    expect(f.height).toEqual({ from: { x: 8, price: 100 }, to: { x: 8, price: 110 } });
  });

  it("draws a cup with handle through its rims, low and handle on the rim line", () => {
    const f = patternFigure(
      view({
        pattern: "cupWithHandle",
        points: [
          { x: 9, price: 120, label: "Left rim" },
          { x: 29, price: 101, label: "Cup low" },
          { x: 59, price: 120, label: "Right rim" },
          { x: 65, price: 114, label: "Handle low" },
        ],
        lines: [{ x1: 9, p1: 120, x2: 70, p2: 120, label: "Rim" }],
      }),
    );
    expect(f.fill.slice(1, 5).map((p) => p.price)).toEqual([120, 101, 120, 114]);
    expect(f.height).toEqual({ from: { x: 29, price: 101 }, to: { x: 29, price: 120 } });
  });

  it("draws a sweep as the swept level and the wick", () => {
    const f = patternFigure(
      view({
        pattern: "bullishSweep",
        points: [
          { x: 25, price: 89.5, label: "Swing low" },
          { x: 30, price: 88.5, label: "Sweep" },
        ],
        lines: [{ x1: 25, p1: 89.5, x2: 30, p2: 89.5, label: "Swept level" }],
      }),
    );
    expect(f.fill).toEqual([]);
    expect(f.strokes[0].dashed).toBe(true);
    expect(f.dots.map((d) => d.price)).toEqual([89.5, 88.5]);
  });

  it("tells candlestick patterns from chart patterns", () => {
    expect(isChartPattern(doubleBottom)).toBe(true);
    expect(isChartPattern(view({ pattern: "hammer" }))).toBe(false);
  });
});

describe("candleSpan", () => {
  const engulfing = view({
    pattern: "bullishEngulfing",
    points: [
      { x: 10, price: 95, label: "" },
      { x: 11, price: 94, label: "" },
    ],
    // the two pattern candles, then the confirmation candle
    blocks: [
      { from: 9.5, to: 10.5 },
      { from: 10.5, to: 11.5 },
      { from: 11.5, to: 12.5 },
    ],
    startX: 9.5,
    entryX: 12.5,
  });

  it("boxes the pattern's own candles and leaves the confirmation candle out", () => {
    expect(candleSpan(engulfing)).toEqual({ from: 9.5, to: 11.5 });
  });

  it("keeps a self-confirming pattern's last candle (morning star) in the box", () => {
    const star = view({
      pattern: "morningStar",
      points: [10, 11, 12].map((x) => ({ x, price: 95, label: "" })),
      blocks: [
        { from: 9.5, to: 10.5 },
        { from: 10.5, to: 11.5 },
        { from: 11.5, to: 12.5 },
      ],
      startX: 9.5,
    });
    expect(candleSpan(star)).toEqual({ from: 9.5, to: 12.5 });
  });
});
