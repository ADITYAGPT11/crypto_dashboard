import { describe, expect, it } from "vite-plus/test";
import { isChartPattern, patternFigure, positionBox } from "../patternGeometry";
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
    extreme: 90,
    entry: 106,
    stop: 89,
    target: 115,
    outcome: { result: "open", r: 0 },
    exitX: null,
    windowEndX: 60.5,
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
    expect(f.projection?.from).toEqual({ x: 30, price: 105 });
    expect(f.projection?.to.price).toBe(115);
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
    expect(f.projection?.text).toBe("Height at start");
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
    expect(f.projection?.text).toBe("Pole length");
  });

  it("tells candlestick patterns from chart patterns", () => {
    expect(isChartPattern(doubleBottom)).toBe(true);
    expect(isChartPattern(view({ pattern: "hammer" }))).toBe(false);
  });
});

describe("positionBox", () => {
  it("spans the outcome window and marks where a loss stopped out", () => {
    const b = positionBox({ ...doubleBottom, outcome: { result: "loss", r: -1 }, exitX: 34.5 });
    expect(b.x1).toBe(30.5);
    expect(b.x2).toBe(60.5);
    expect(b.rr).toBeCloseTo(9 / 17);
    expect(b.exit).toEqual({ x: 34.5, price: 89 });
    expect(b.targetPct).toBeCloseTo((9 / 106) * 100);
  });

  it("reports a target already behind the entry as reward / risk ≤ 0", () => {
    const b = positionBox(
      view({
        direction: "short",
        entry: 100,
        stop: 105,
        target: 101,
        outcome: { result: "win", r: -0.2 },
        exitX: 31.5,
      }),
    );
    expect(b.rr).toBeCloseTo(-0.2);
    expect(b.exit).toEqual({ x: 31.5, price: 101 });
  });

  it("has no exit marker while the trade is open or expired", () => {
    expect(
      positionBox(view({ outcome: { result: "expired", r: 0.3 }, exitX: 60.5 })).exit,
    ).toBeNull();
  });
});
