import { describe, expect, it } from "vite-plus/test";
import type { Candle } from "../../types/marketData";
import type { PatternHit, SetupOccurrence, Zone } from "../../types/analysis";
import {
  logicalAt,
  spanOf,
  TF_MS,
  toViewPattern,
  toViewZones,
  viewBarTimeForClose,
} from "../timeframeMapping";
import { analyzeSymbol, locate, locateAcross } from "../setupAnalysis";
import { atr } from "../indicators";

const H1 = TF_MS["1h"];
const H4 = TF_MS["4h"];
const D1 = TF_MS["1d"];

function series(n: number, ms: number, start = 0, f: (i: number) => number = () => 100): Candle[] {
  return Array.from({ length: n }, (_, i) => {
    const p = f(i);
    return { openTime: start + i * ms, open: p, high: p + 1, low: p - 1, close: p, volume: 100 };
  });
}

describe("logicalAt / spanOf", () => {
  const view = series(48, H1); // two days of 1h

  it("puts a bar's open at its left edge and its close at its right edge", () => {
    expect(logicalAt(view, H1, 0)).toBe(-0.5);
    expect(logicalAt(view, H1, 5 * H1)).toBe(4.5);
    expect(logicalAt(view, H1, 5 * H1 + H1 / 2)).toBe(5);
  });

  it("spans four 1h bars for one 4h candle", () => {
    expect(spanOf(view, H1, 8 * H1, H4)).toEqual({ from: 7.5, to: 11.5 });
  });

  it("spans a quarter bar for a 1h candle on a 4h view", () => {
    const v4 = series(12, H4);
    const s = spanOf(v4, H4, 5 * H1, H1);
    expect(s.from).toBeCloseTo(0.75, 12);
    expect(s.to).toBeCloseTo(1, 12);
  });

  it("extrapolates past the last bar", () => {
    expect(logicalAt(view, H1, 50 * H1)).toBe(49.5);
  });
});

describe("toViewPattern", () => {
  it("draws a 4h pattern on a 1h view as 4-bar blocks with the entry at the 4h close", () => {
    const four = series(20, H4);
    const one = series(80, H1);
    const hit: PatternHit = {
      type: "doubleBottom",
      index: 10,
      entry: 100,
      stop: 95,
      target: 110,
      low: 95,
      neckline: 105,
      points: [
        { index: 2, price: 95 },
        { index: 5, price: 105 },
        { index: 8, price: 95.2 },
      ],
    };
    const occ = {
      symbol: "X",
      hit,
      location: "openSpace",
      time: four[10].openTime,
    } as SetupOccurrence;
    const vp = toViewPattern(occ, "4h", four, one, "1h");
    expect(vp.blocks).toEqual([
      { from: 7.5, to: 11.5 },
      { from: 19.5, to: 23.5 },
      { from: 31.5, to: 35.5 },
      { from: 39.5, to: 43.5 },
    ]);
    expect(vp.points.map((p) => p.x)).toEqual([9.5, 21.5, 33.5]);
    // signal exists when 4h candle 10 closes = end of 1h bar 43
    expect(vp.entryX).toBe(43.5);
    expect(vp.startX).toBe(7.5);
  });
});

describe("toViewPattern line", () => {
  it("maps a sloped neckline from 4h candles onto a 1h view", () => {
    const four = series(20, H4);
    const one = series(80, H1);
    const hit: PatternHit = {
      type: "inverseHeadShoulders",
      index: 12,
      entry: 100,
      stop: 95,
      target: 110,
      low: 90,
      points: [
        { index: 2, price: 95 },
        { index: 4, price: 100 },
        { index: 6, price: 90 },
      ],
      line: { from: { index: 4, price: 100 }, to: { index: 12, price: 102 } },
    };
    const occ = { symbol: "X", hit, location: "openSpace", time: 0 } as SetupOccurrence;
    const vp = toViewPattern(occ, "4h", four, one, "1h");
    // 4h candle 4 = 1h bars 16–19 (centre 17.5); 4h candle 12 = bars 48–51 (centre 49.5)
    expect(vp.line).toEqual({ x1: 17.5, p1: 100, x2: 49.5, p2: 102 });
  });
});

describe("toViewZones and markers", () => {
  it("maps zone start and break through time", () => {
    const daily = series(10, D1);
    const view = series(10 * 6, H4);
    const zone: Zone = {
      kind: "demand",
      low: 90,
      high: 95,
      startIndex: 2,
      formedIndex: 3,
      endIndex: 6,
      tests: 0,
      held: 0,
    };
    const [vz] = toViewZones([zone], "1d", daily, view, "4h");
    expect(vz.from).toBe(11.5); // day 2 open = 4h bar 12
    expect(vz.to).toBe(41.5); // close of day 6 = end of 4h bar 41
    expect(toViewZones([{ ...zone, endIndex: null }], "1d", daily, view, "4h")[0].to).toBeNull();
  });

  it("puts a higher-TF marker on the view bar where that candle closes", () => {
    const view = series(24, H1);
    expect(viewBarTimeForClose(view, 4 * H1, H4)).toBe(7 * H1);
  });
});

describe("locateAcross (no look-ahead)", () => {
  // 4h pattern candles; daily zones.
  const four = series(60, H4, 0, () => 100);
  const daily = series(12, D1, 0, () => 100);
  const hit: PatternHit = {
    type: "hammer",
    index: 40, // day 6, 16:00 (opens 40·4h = 160h; closes 164h)
    entry: 100,
    stop: 94,
    target: 109,
    low: 96,
    points: [{ index: 40, price: 96 }],
  };
  const zone = (formedIndex: number, endIndex: number | null): Zone => ({
    kind: "demand",
    low: 95,
    high: 98,
    startIndex: formedIndex - 1,
    formedIndex,
    endIndex,
    tests: 0,
    held: 0,
  });
  const loc = (z: Zone) => locateAcross(hit, four, H4, [z], daily, D1, 1);

  it("uses a daily zone whose impulse day closed before the pattern began", () => {
    expect(loc(zone(5, null))).toBe("demandZone"); // day 5 closes at 144h ≤ 160h
  });

  it("ignores a zone whose impulse day was still forming", () => {
    expect(loc(zone(6, null))).toBe("openSpace"); // day 6 closes at 168h > 160h
  });

  it("keeps a zone whose break is only known after the pattern confirmed", () => {
    expect(loc(zone(5, 6))).toBe("demandZone"); // break day closes 168h > 164h
    expect(loc(zone(4, 5))).toBe("openSpace"); // broke on day 5, known at 144h
  });

  it("matches the same-timeframe locate on generated data", () => {
    const wave = series(600, H4, 0, (i) => 100 + 8 * Math.sin(i / 9) + 3 * Math.sin(i / 2.3));
    wave.forEach((c, i) => {
      c.volume = 100 + ((i * 37) % 200);
      c.open = c.close - 0.3;
      c.high = c.close + 1 + (i % 5) * 0.4;
      c.low = c.close - 1 - (i % 7) * 0.3;
      // Every 40 candles near a trough: a strong high-volume up candle (forms a demand zone)
      if (i % 40 === 21) {
        c.open = c.close - 7;
        c.low = c.open - 0.2;
        c.high = c.close + 0.2;
        c.volume = 900;
      }
    });
    const same = analyzeSymbol("X", wave);
    const across = analyzeSymbol("X", wave, { candles: wave, patternMs: H4, zoneMs: H4 });
    const atrs = atr(wave, 14);
    expect(across.occurrences.map((o) => o.location)).toEqual(
      same.occurrences.map((o) => locate(o.hit, same.zones, atrs[o.hit.index])),
    );
    expect(same.occurrences.length).toBeGreaterThan(0);
    expect(same.occurrences.some((o) => o.location === "demandZone")).toBe(true);
  });
});
