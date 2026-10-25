import { describe, expect, it } from "vite-plus/test";
import type { Candle } from "../../types/marketData";
import {
  INTERVAL_TO_MS,
  MAX_CANDLE_BUFFER,
  mergeCandle,
  normalizeHistory,
  toCanonicalInterval,
  toCandle,
} from "../candleUtils";
import type { CandleData } from "../../types/marketData";

function candleData(overrides: Partial<CandleData> = {}): CandleData {
  return {
    exchange: "BINANCE",
    symbol: "BTC-USDT",
    type: "SPOT",
    interval: "1m",
    candle: { openTime: 0, open: 100, high: 110, low: 95, close: 105, volume: 10 },
    ...overrides,
  };
}

describe("toCanonicalInterval", () => {
  it("normalizes exchange-native spellings", () => {
    expect(toCanonicalInterval("1m")).toBe("1m");
    expect(toCanonicalInterval("1H")).toBe("1h");
    expect(toCanonicalInterval("1D")).toBe("1d");
    expect(toCanonicalInterval("4H")).toBe("4h");
    expect(toCanonicalInterval("15m")).toBe("15m");
  });

  it("returns null for unknown intervals", () => {
    expect(toCanonicalInterval("2m")).toBeNull();
    expect(toCanonicalInterval("")).toBeNull();
  });
});

describe("toCandle", () => {
  it("accepts a valid candle and preserves closed flag", () => {
    const c = toCandle({
      openTime: 1234,
      open: 100,
      high: 110,
      low: 95,
      close: 105,
      volume: 7,
      closed: true,
    });
    expect(c).toEqual({
      openTime: 1234,
      open: 100,
      high: 110,
      low: 95,
      close: 105,
      volume: 7,
      closed: true,
    });
  });

  it("rejects malformed rows without throwing", () => {
    expect(toCandle(null)).toBeNull();
    expect(toCandle({ openTime: "x" })).toBeNull();
    expect(toCandle({ openTime: 1, open: NaN, high: 1, low: 1, close: 1 })).toBeNull();
    expect(toCandle({ openTime: 1, open: 10, high: 5, low: 15, close: 12 })).toBeNull(); // high < low
    expect(toCandle({ openTime: 1, open: 20, high: 15, low: 5, close: 10 })).toBeNull();
  });

  it("defaults invalid volume to 0", () => {
    const c = toCandle({ openTime: 1, open: 10, high: 12, low: 9, close: 11, volume: -3 });
    expect(c?.volume).toBe(0);
  });
});

describe("mergeCandle", () => {
  it("replaces the last candle on the same openTime", () => {
    const arr: Candle[] = [
      { openTime: 60_000, open: 1, high: 1, low: 1, close: 1, volume: 0, closed: false },
    ];
    const next = candleData({
      candle: { openTime: 60_000, open: 2, high: 3, low: 1, close: 2, volume: 5, closed: true },
    });
    mergeCandle(arr, next);
    expect(arr).toHaveLength(1);
    expect(arr[0].open).toBe(2);
    expect(arr[0].closed).toBe(true);
  });

  it("appends newer candles and ignores older/stale ones", () => {
    const arr = [
      { openTime: 60_000, open: 1, high: 1, low: 1, close: 1, volume: 0 },
      { openTime: 120_000, open: 1, high: 1, low: 1, close: 1, volume: 0 },
    ];
    mergeCandle(
      arr,
      candleData({ candle: { openTime: 180_000, open: 1, high: 1, low: 1, close: 1, volume: 0 } }),
    );
    expect(arr.map((c) => c.openTime)).toEqual([60_000, 120_000, 180_000]);
    mergeCandle(
      arr,
      candleData({ candle: { openTime: 60_000, open: 9, high: 9, low: 9, close: 9, volume: 0 } }),
    );
    expect(arr.map((c) => c.openTime)).toEqual([60_000, 120_000, 180_000]);
    expect(arr[0].open).toBe(1);
  });

  it("trims the buffer to MAX_CANDLE_BUFFER", () => {
    const arr = Array.from({ length: MAX_CANDLE_BUFFER }, (_, i) => ({
      openTime: (i + 1) * 60_000,
      open: 1,
      high: 1,
      low: 1,
      close: 1,
      volume: 0,
    }));
    mergeCandle(
      arr,
      candleData({
        candle: {
          openTime: (MAX_CANDLE_BUFFER + 1) * 60_000,
          open: 1,
          high: 1,
          low: 1,
          close: 1,
          volume: 0,
        },
      }),
    );
    expect(arr).toHaveLength(MAX_CANDLE_BUFFER);
    expect(arr[0].openTime).toBe(60_000 * 2);
    expect(arr[MAX_CANDLE_BUFFER - 1].openTime).toBe((MAX_CANDLE_BUFFER + 1) * 60_000);
  });
});

describe("normalizeHistory", () => {
  it("parses, sorts ascending and dedupes by openTime", () => {
    const rows = [
      { openTime: 180_000, open: 3, high: 3, low: 3, close: 3, volume: 0 },
      { openTime: 60_000, open: 1, high: 1, low: 1, close: 1, volume: 0 },
      { openTime: 180_000, open: 3.5, high: 3.5, low: 3.5, close: 3.5, volume: 0 },
      "garbage" as unknown as { openTime: number },
    ];
    const out = normalizeHistory(rows);
    expect(out.map((c) => c.openTime)).toEqual([60_000, 180_000]);
    expect(out[1].open).toBe(3.5);
  });
});

describe("INTERVAL_TO_MS", () => {
  it("maps each interval to the right ms", () => {
    expect(INTERVAL_TO_MS["1m"]).toBe(60_000);
    expect(INTERVAL_TO_MS["1h"]).toBe(3_600_000);
    expect(INTERVAL_TO_MS["1d"]).toBe(86_400_000);
  });
});
