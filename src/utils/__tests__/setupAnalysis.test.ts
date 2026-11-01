import { describe, expect, it } from "vite-plus/test";
import type { Candle } from "../../types/marketData";
import type { PatternHit, SetupOccurrence } from "../../types/analysis";
import { wilson, median } from "../stats";
import { computeVolumeProfile } from "../volumeProfile";
import { detectZones, activeZonesAt } from "../zones";
import {
  detectBullishEngulfing,
  detectDoubleBottoms,
  detectHammers,
  PIVOT_BARS,
} from "../patterns";
import { evaluateOutcome, locate, summarize, verdictFor, MIN_SAMPLE } from "../setupAnalysis";

const H = 3_600_000;

/** Quiet candles drifting around `price` with a small fixed range. */
function flat(n: number, price: number, startIndex = 0, range = 1, volume = 100): Candle[] {
  return Array.from({ length: n }, (_, k) => {
    const i = startIndex + k;
    const wiggle = (i % 4) * 0.1;
    const close = price + wiggle;
    return {
      openTime: i * H,
      open: close - 0.05,
      high: close + range / 2,
      low: close - range / 2,
      close,
      volume,
    };
  });
}

function c(
  i: number,
  open: number,
  high: number,
  low: number,
  close: number,
  volume = 100,
): Candle {
  return { openTime: i * H, open, high, low, close, volume };
}

/** Linear walk from `from` to `to` over n candles, each with a 1-point range. */
function walk(startIndex: number, n: number, from: number, to: number): Candle[] {
  return Array.from({ length: n }, (_, k) => {
    const close = from + ((to - from) * (k + 1)) / n;
    const open = from + ((to - from) * k) / n;
    return c(startIndex + k, open, Math.max(open, close) + 0.5, Math.min(open, close) - 0.5, close);
  });
}

describe("wilson", () => {
  it("matches reference values", () => {
    const [lo1, hi1] = wilson(4, 5);
    expect(lo1).toBeCloseTo(0.376, 3);
    expect(hi1).toBeCloseTo(0.964, 3);
    const [lo2, hi2] = wilson(129, 212);
    expect(lo2).toBeCloseTo(0.541, 3);
    expect(hi2).toBeCloseTo(0.672, 3);
  });
  it("is [0,1] with no data and stays in bounds at the extremes", () => {
    expect(wilson(0, 0)).toEqual([0, 1]);
    const [lo, hi] = wilson(10, 10);
    expect(lo).toBeGreaterThan(0.6);
    expect(hi).toBe(1);
  });
  it("median handles odd, even and empty", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBe(0);
  });
});

describe("computeVolumeProfile", () => {
  it("puts the POC where volume concentrates and the value area around it", () => {
    const candles = [
      ...flat(10, 100, 0, 1, 10),
      ...flat(10, 110, 10, 1, 1000),
      ...flat(10, 120, 20, 1, 10),
    ];
    const vp = computeVolumeProfile(candles, 30)!;
    expect(vp.pocPrice).toBeGreaterThan(109);
    expect(vp.pocPrice).toBeLessThan(111.5);
    expect(vp.valPrice).toBeLessThanOrEqual(vp.pocPrice);
    expect(vp.vahPrice).toBeGreaterThanOrEqual(vp.pocPrice);
    const total = vp.volumes.reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(10 * 10 + 10 * 1000 + 10 * 10, 6);
  });
  it("returns null without a price range", () => {
    expect(computeVolumeProfile([])).toBeNull();
    expect(computeVolumeProfile([c(0, 1, 1, 1, 1)])).toBeNull();
  });
});

describe("detectZones", () => {
  // 30 quiet candles, a base at ~100, a big high-volume bullish impulse, then drift up.
  function demandSetup(): Candle[] {
    const quiet = flat(30, 100);
    const base = c(30, 100.2, 100.6, 99.6, 100.0);
    const impulse = c(31, 100.0, 105.0, 99.9, 104.8, 400);
    const after = walk(32, 6, 104.8, 107);
    return [...quiet, base, impulse, ...after];
  }

  it("finds a demand zone at the base before a bullish impulse", () => {
    const zones = detectZones(demandSetup());
    const demand = zones.filter((z) => z.kind === "demand");
    expect(demand).toHaveLength(1);
    expect(demand[0].startIndex).toBe(30);
    expect(demand[0].formedIndex).toBe(31);
    expect(demand[0].low).toBeCloseTo(99.6, 6);
    expect(demand[0].high).toBeGreaterThanOrEqual(100.2);
    expect(demand[0].tests).toBe(0);
    expect(demand[0].endIndex).toBeNull();
  });

  it("counts a held test and a later break", () => {
    const base = demandSetup();
    const n = base.length;
    const retest = c(n, 102, 102.2, 100.1, 101.9); // dips into zone, closes back above
    const away = c(n + 1, 101.9, 103, 101.5, 102.8);
    const breakdown = c(n + 2, 102.8, 102.9, 98.5, 98.8); // closes below zone low
    const [zone] = detectZones([...base, retest, away, breakdown]).filter(
      (z) => z.kind === "demand",
    );
    // The breakdown candle re-enters the zone: a second test, which fails.
    expect(zone.tests).toBe(2);
    expect(zone.held).toBe(1);
    expect(zone.endIndex).toBe(n + 2);
    expect(activeZonesAt([zone], n + 1, "demand")).toHaveLength(1);
    expect(activeZonesAt([zone], n + 2, "demand")).toHaveLength(0);
  });

  it("ignores a large candle without above-average volume", () => {
    const quiet = flat(30, 100);
    const big = c(30, 100, 105, 99.9, 104.8, 100);
    expect(detectZones([...quiet, big]).length).toBe(0);
  });
});

describe("detectDoubleBottoms", () => {
  // Decline to 90, bounce to 96 (neckline), retest 90.2, then break above 96.
  function wSeries(breakout = true): Candle[] {
    const lead = flat(20, 100, 0, 1);
    const down = walk(20, 10, 100, 90);
    const up = walk(30, 8, 90, 96);
    const down2 = walk(38, 8, 96, 90.2);
    const up2 = breakout ? walk(46, 10, 90.2, 98) : walk(46, 10, 90.2, 94);
    const tail = flat(10, breakout ? 98 : 94, 56, 1);
    return [...lead, ...down, ...up, ...down2, ...up2, ...tail];
  }

  it("confirms on the first close above the neckline, with a measured-move target", () => {
    const candles = wSeries();
    const hits = detectDoubleBottoms(candles);
    expect(hits).toHaveLength(1);
    const h = hits[0];
    const neckline = h.neckline!;
    expect(neckline).toBeGreaterThan(95.9);
    expect(candles[h.index].close).toBeGreaterThan(neckline);
    expect(candles[h.index - 1].close).toBeLessThanOrEqual(neckline);
    expect(h.target).toBeCloseTo(neckline + (neckline - h.low), 6);
    expect(h.stop).toBeLessThan(h.low);
    expect(h.entry).toBe(candles[h.index].close);
  });

  it("never confirms before the second low is a known swing low (no lookahead)", () => {
    const h = detectDoubleBottoms(wSeries())[0];
    const secondLow = h.points[2].index;
    expect(h.index).toBeGreaterThanOrEqual(secondLow + PIVOT_BARS);
  });

  it("does not fire without a neckline break", () => {
    expect(detectDoubleBottoms(wSeries(false))).toHaveLength(0);
  });
});

describe("candle patterns", () => {
  const base = walk(0, 20, 110, 100); // 20 candles of decline to build ATR

  it("detects a bullish engulfing candle", () => {
    const red = c(20, 100.5, 100.8, 98.9, 99.0);
    const green = c(21, 98.9, 101.2, 98.7, 101.0);
    const hits = detectBullishEngulfing([...base, red, green]);
    const last = hits[hits.length - 1];
    expect(last.index).toBe(21);
    expect(last.stop).toBeLessThan(98.7);
    expect(last.target - last.entry).toBeCloseTo(1.5 * (last.entry - last.stop), 6);
  });

  it("detects a hammer after a decline", () => {
    const hammer = c(20, 99.6, 99.9, 97.0, 99.8);
    const hits = detectHammers([...base, hammer]);
    expect(hits.map((h) => h.index)).toContain(20);
  });

  it("rejects a hammer shape without a prior decline", () => {
    const rising = walk(0, 20, 90, 100);
    const shape = c(20, 100.6, 100.9, 98.0, 100.8);
    expect(detectHammers([...rising, shape]).map((h) => h.index)).not.toContain(20);
  });
});

describe("evaluateOutcome", () => {
  const hit: PatternHit = {
    type: "hammer",
    index: 0,
    entry: 100,
    stop: 98,
    target: 103,
    low: 98.1,
    points: [],
  };

  it("wins when the target is hit first", () => {
    const o = evaluateOutcome(
      [c(0, 100, 100, 100, 100), c(1, 100, 101, 99, 100.5), c(2, 100.5, 103.5, 100, 103)],
      hit,
    );
    expect(o.result).toBe("win");
    expect(o.bars).toBe(2);
    expect(o.r).toBeCloseTo(1.5, 6);
    expect(o.movePct).toBeCloseTo(3, 6);
  });

  it("counts a candle touching both stop and target as a loss", () => {
    const o = evaluateOutcome([c(0, 100, 100, 100, 100), c(1, 100, 104, 97, 101)], hit);
    expect(o.result).toBe("loss");
    expect(o.r).toBe(-1);
  });

  it("expires after the hold window and stays open when data runs out", () => {
    const quiet = [c(0, 100, 100, 100, 100), ...flat(40, 100, 1, 1)];
    expect(evaluateOutcome(quiet, hit, 30).result).toBe("expired");
    expect(evaluateOutcome(quiet.slice(0, 10), hit, 30).result).toBe("open");
  });
});

describe("locate and summarize", () => {
  it("places a pattern low inside an earlier intact demand zone", () => {
    const zone = {
      kind: "demand" as const,
      low: 95,
      high: 97,
      startIndex: 4,
      formedIndex: 5,
      endIndex: null,
      tests: 1,
      held: 1,
    };
    const inZone: PatternHit = {
      type: "hammer",
      index: 20,
      entry: 99,
      stop: 95.5,
      target: 104,
      low: 96,
      points: [{ index: 20, price: 96 }],
    };
    const outside: PatternHit = { ...inZone, low: 90, points: [{ index: 20, price: 90 }] };
    expect(locate(inZone, [zone], 1)).toBe("demandZone");
    expect(locate(outside, [zone], 1)).toBe("openSpace");
    expect(locate(inZone, [{ ...zone, endIndex: 10 }], 1)).toBe("openSpace");
  });

  function occ(result: "win" | "loss" | "expired", i: number): SetupOccurrence {
    const win = result === "win";
    return {
      symbol: "BTC-USDT",
      hit: {
        type: "doubleBottom",
        index: i,
        entry: 100,
        stop: 98,
        target: 103,
        low: 98.5,
        points: [],
      },
      location: "demandZone",
      outcome: {
        result,
        exitIndex: i + 3,
        movePct: win ? 3 : result === "loss" ? -2 : 0,
        r: win ? 1.5 : result === "loss" ? -1 : 0,
        bars: 3,
      },
      time: i * H,
    };
  }

  it("computes win rate, break-even, expectancy and newest-first recent cases", () => {
    const list = [occ("win", 1), occ("win", 2), occ("loss", 3), occ("expired", 4)];
    const s = summarize("doubleBottom", "demandZone", list);
    expect(s.n).toBe(3);
    expect(s.wins).toBe(2);
    expect(s.expired).toBe(1);
    expect(s.winRate).toBeCloseTo(2 / 3, 6);
    expect(s.breakEven).toBeCloseTo(1 / 2.5, 6);
    expect(s.expectancyR).toBeCloseTo((1.5 + 1.5 - 1) / 3, 6);
    expect(s.recent[0].hit.index).toBe(3);
    expect(s.verdict).toBe("tooFew");
  });

  it("gives a verdict against break-even only with enough cases", () => {
    expect(verdictFor(MIN_SAMPLE - 1, 0.9, 0.4)).toBe("tooFew");
    expect(verdictFor(MIN_SAMPLE, 0.45, 0.4)).toBe("edge");
    expect(verdictFor(MIN_SAMPLE, 0.38, 0.4)).toBe("noEdge");
  });
});
