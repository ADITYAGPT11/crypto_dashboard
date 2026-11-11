import { describe, expect, it } from "vite-plus/test";
import type { Candle } from "../../types/marketData";
import type { OccurrenceOut } from "../../api/schema";
import type { Zone } from "../../types/analysis";
import {
  logicalAt,
  spanOf,
  TF_MS,
  toViewLevels,
  toViewPattern,
  viewBarTimeForClose,
} from "../timeframeMapping";

const H1 = TF_MS["1h"];
const H4 = TF_MS["4h"];
const D1 = TF_MS["1d"];

function series(n: number, ms: number, start = 0): Candle[] {
  return Array.from({ length: n }, (_, i) => ({
    openTime: start + i * ms,
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 100,
  }));
}

const pt = (time: number, price: number, label = "") => ({ time, price, label });

function occurrence(partial: Partial<OccurrenceOut>): OccurrenceOut {
  return {
    pattern: "doubleBottom",
    direction: "long",
    location: "openSpace",
    time: 0,
    startTime: 0,
    entry: 100,
    stop: 95,
    target: 110,
    extreme: 95,
    points: [],
    lines: [],
    outcome: { result: "open", exitTime: null, movePct: 0, r: 0, bars: 0 },
    ...partial,
  };
}

describe("logicalAt / spanOf", () => {
  const view = series(48, H1);

  it("puts a bar's open at its left edge and its close at its right edge", () => {
    expect(logicalAt(view, H1, 0)).toBe(-0.5);
    expect(logicalAt(view, H1, 5 * H1)).toBe(4.5);
    expect(logicalAt(view, H1, 5 * H1 + H1 / 2)).toBe(5);
  });

  it("spans four 1h bars for one 4h candle", () => {
    expect(spanOf(view, H1, 8 * H1, H4)).toEqual({ from: 7.5, to: 11.5 });
  });

  it("spans a quarter bar for a 1h candle on a 4h view", () => {
    const s = spanOf(series(12, H4), H4, 5 * H1, H1);
    expect(s.from).toBeCloseTo(0.75, 12);
    expect(s.to).toBeCloseTo(1, 12);
  });

  it("extrapolates past the last bar", () => {
    expect(logicalAt(view, H1, 50 * H1)).toBe(49.5);
  });
});

describe("toViewPattern", () => {
  it("draws a 4h pattern on a 1h view as 4-bar blocks with the entry at the 4h close", () => {
    const one = series(80, H1);
    const occ = occurrence({
      time: 10 * H4,
      startTime: 2 * H4,
      points: [pt(2 * H4, 95), pt(5 * H4, 105), pt(8 * H4, 95.2)],
    });
    const vp = toViewPattern(occ, "4h", one, "1h");
    expect(vp.blocks).toEqual([
      { from: 7.5, to: 11.5 },
      { from: 19.5, to: 23.5 },
      { from: 31.5, to: 35.5 },
      { from: 39.5, to: 43.5 },
    ]);
    expect(vp.points.map((p) => p.x)).toEqual([9.5, 21.5, 33.5]);
    expect(vp.entryX).toBe(43.5); // the signal exists when 4h candle 10 closes
    expect(vp.startX).toBe(7.5);
  });

  it("maps sloped lines from 4h candles onto a 1h view", () => {
    const occ = occurrence({
      time: 12 * H4,
      lines: [{ a: pt(4 * H4, 100), b: pt(12 * H4, 102), label: "Neckline" }],
    });
    const vp = toViewPattern(occ, "4h", series(80, H1), "1h");
    expect(vp.lines).toEqual([{ x1: 17.5, p1: 100, x2: 49.5, p2: 102, label: "Neckline" }]);
  });
});

describe("toViewLevels and markers", () => {
  it("maps a daily zone's start and break through time onto a 4h view", () => {
    const view = series(60, H4);
    const zone: Zone = {
      kind: "demand",
      low: 90,
      high: 92,
      startTime: 2 * D1,
      formedTime: 3 * D1,
      endTime: 5 * D1,
      tests: 1,
      held: 0,
      departureAtr: 2,
    };
    const [v] = toViewLevels({ zones: [zone], orderBlocks: [], fvgs: [] }, "1d", view, "4h");
    expect(v.from).toBe(11.5); // day 2 opens at 4h bar 12
    expect(v.to).toBe(35.5); // day 5 closes at the end of 4h bar 35
    expect(v.fresh).toBe(false);
  });

  it("keeps intact order blocks open to the right edge", () => {
    const view = series(20, H1);
    const [b] = toViewLevels(
      {
        zones: [],
        orderBlocks: [
          {
            kind: "bullish",
            low: 1,
            high: 2,
            time: 3 * H1,
            formedTime: 6 * H1,
            endTime: null,
            mitigatedTime: null,
            broke: 3,
          },
        ],
        fvgs: [],
      },
      "1h",
      view,
      "1h",
    );
    expect(b).toMatchObject({ layer: "orderBlock", from: 2.5, to: null, fresh: true });
  });

  it("places a marker on the view bar in which the source candle closes", () => {
    const view = series(24, H1);
    expect(viewBarTimeForClose(view, 4 * H1, H4)).toBe(7 * H1);
  });
});
