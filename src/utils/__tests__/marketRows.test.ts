import { describe, expect, it } from "vite-plus/test";
import type { Candle } from "../../types/marketData";
import { buildCoinRows, dailyCloses, meanOf } from "../marketRows";

const H4 = 14_400_000;
const DAY = 86_400_000;

function series(n: number, f: (i: number) => number): Candle[] {
  return Array.from({ length: n }, (_, i) => {
    const p = f(i);
    return { openTime: i * H4, open: p, high: p * 1.01, low: p * 0.99, close: p, volume: 1 };
  });
}

describe("dailyCloses", () => {
  it("keeps the last 4h close of each finished UTC day", () => {
    const c = series(14, (i) => 100 + i); // 2 full days + 2 candles of day 3
    expect(dailyCloses(c)).toEqual([105, 111]);
    expect(dailyCloses(series(12, (i) => i))).toEqual([5, 11]);
    expect(dailyCloses([])).toEqual([]);
    expect(12 * H4).toBe(2 * DAY);
  });
});

describe("buildCoinRows", () => {
  it("prefers exchange ticker values and computes the rest from candles", () => {
    const candles = new Map([["BTC-USDT", series(400, (i) => 100 + i)]]);
    const rows = buildCoinRows({
      symbols: ["BTC-USDT", "ETH-USDT"],
      candles,
      tickers: [{ symbol: "BTC-USDT", price: 600, changePct: 2.5, quoteVolume: 1e9 }],
      funding: new Map([["BTC-USDT", { fundingPct: 0.01 }]]),
      openInterest: new Map(),
      corrBtc: new Map([["BTC-USDT", 1]]),
    });
    expect(rows).toHaveLength(1); // ETH has neither ticker nor candles
    const r = rows[0];
    expect(r).toMatchObject({ base: "BTC", price: 600, change24h: 2.5, quoteVolume: 1e9 });
    expect(r.change7d).toBeCloseTo(((499 - 457) / 457) * 100, 10);
    expect(r.trend4h).toBe(true);
    expect(r.trend1d).toBe(true);
    expect(r.fundingPct).toBe(0.01);
    expect(r.oiChange24h).toBeNull();
    expect(r.vol7d).toBeGreaterThan(0);
  });
});

describe("meanOf", () => {
  it("averages finite values only", () => {
    expect(meanOf([1, null, 3, Number.NaN])).toBe(2);
    expect(meanOf([])).toBeNull();
  });
});
