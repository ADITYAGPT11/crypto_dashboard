import { describe, expect, it } from "vite-plus/test";
import { atr, bollingerBands, ema, macd, rsi, sma, vwap, type CandleLike } from "../indicators";

function candles(n: number, base = 100): CandleLike[] {
  return Array.from({ length: n }, (_, i) => {
    const drift = i % 3 === 0 ? 1 : i % 3 === 1 ? -0.5 : 0.25;
    const close = base + i * drift;
    return {
      openTime: i * 60_000,
      open: close - 0.5,
      high: close + 1,
      low: close - 1.5,
      close,
      volume: 100 + i,
    };
  });
}

const closes = candles(60).map((c) => c.close);

describe("sma", () => {
  it("produces NaN warm-up then rolling means", () => {
    const out = sma([1, 2, 3, 4, 5], 3);
    expect(out.slice(0, 2)).toEqual([NaN, NaN]);
    expect(out.slice(2)).toEqual([2, 3, 4]);
  });

  it("handles period >= length", () => {
    expect(sma([1, 2], 5).every(Number.isNaN)).toBe(true);
  });
});

describe("ema", () => {
  it("seeds with SMA then applies alpha smoothing", () => {
    const out = ema([1, 2, 3, 4, 5], 3);
    expect(out[0]).toBeNaN();
    expect(out[1]).toBeNaN();
    expect(out[2]).toBeCloseTo(2, 10); // SMA seed
    const alpha = 2 / 4;
    expect(out[3]).toBeCloseTo(alpha * 4 + (1 - alpha) * 2, 10);
    expect(out[4]).toBeCloseTo(alpha * 5 + (1 - alpha) * out[3], 10);
  });

  it("is iterative (handles long series)", () => {
    const long = Array.from({ length: 1000 }, (_, i) => i);
    const out = ema(long, 12);
    expect(out[999]).toBeGreaterThan(990); // trailing a linear ramp with lag
    expect(Number.isFinite(out[11])).toBe(true);
  });
});

describe("rsi", () => {
  it("stays within [0,100] and is NaN during warm-up", () => {
    const out = rsi(closes, 14);
    for (let i = 0; i < 14; i++) expect(out[i]).toBeNaN();
    for (let i = 14; i < out.length; i++) {
      expect(out[i]).toBeGreaterThanOrEqual(0);
      expect(out[i]).toBeLessThanOrEqual(100);
    }
  });

  it("returns 100 after strictly rising closes", () => {
    const rising = Array.from({ length: 20 }, (_, i) => 100 + i);
    expect(rsi(rising, 14)[19]).toBe(100);
  });

  it("returns 0 after strictly falling closes with losses only", () => {
    const falling = Array.from({ length: 20 }, (_, i) => 100 - i);
    expect(rsi(falling, 14)[19]).toBe(0);
  });
});

describe("macd", () => {
  it("aligns to input and fills warm-up with NaN", () => {
    const out = macd(closes, 12, 26, 9);
    expect(out).toHaveLength(closes.length);
    expect(Number.isNaN(out[25].macd)).toBe(true);
    for (let i = 26 + 9 - 2; i < out.length; i++) {
      expect(Number.isFinite(out[i].macd)).toBe(true);
      expect(Number.isFinite(out[i].signal)).toBe(true);
      expect(out[i].histogram).toBeCloseTo(out[i].macd - out[i].signal, 10);
    }
  });
});

describe("vwap", () => {
  it("is NaN on slot 0 outside a day anchor", () => {
    const cs = candles(5);
    const out = vwap(cs);
    expect(out[0]).toBeNaN();
    expect(out[1]).toBeGreaterThan(0);
  });

  it("resets at the UTC day boundary", () => {
    const cs: CandleLike[] = [
      { openTime: 0, open: 1, high: 2, low: 1, close: 2, volume: 100 },
      { openTime: 60_000, open: 1, high: 2, low: 1, close: 2, volume: 100 },
      { openTime: 86_400_000, open: 10, high: 20, low: 10, close: 20, volume: 100 },
    ];
    const out = vwap(cs);
    // typical price of candle 1 = (high 2 + low 1 + close 2)/3 = 5/3; volume 100 both days cancels
    expect(out[1]).toBeCloseTo(5 / 3, 10);
    // day 2 resets: only the day-2 candle contributes
    expect(out[2]).toBeCloseTo((20 + 10 + 20) / 3, 10);
  });
});

describe("bollingerBands", () => {
  it("middle equals SMA and bands are symmetric", () => {
    const values = Array.from({ length: 30 }, (_, i) => Math.sin(i) * 10 + 100);
    const out = bollingerBands(values, 20, 2);
    const i = 25;
    expect(out[i].middle).toBeCloseTo(sma(values, 20)[i], 10);
    expect(out[i].upper - out[i].middle).toBeCloseTo(out[i].middle - out[i].lower, 10);
    expect(out[i].upper).toBeGreaterThan(out[i].middle);
    expect(Number.isNaN(out[10].upper)).toBe(true);
  });

  it("collapses when values are constant", () => {
    const out = bollingerBands(
      Array.from({ length: 25 }, () => 5),
      20,
      2,
    );
    expect(out[24].upper).toBeCloseTo(5, 10);
    expect(out[24].lower).toBeCloseTo(5, 10);
  });
});

describe("atr", () => {
  it("is NaN through warm-up, then finite and >= 0", () => {
    const cs = candles(40);
    const out = atr(cs, 14);
    for (let i = 0; i < 14; i++) expect(out[i]).toBeNaN();
    for (let i = 14; i < out.length; i++) {
      expect(Number.isFinite(out[i])).toBe(true);
      expect(out[i]).toBeGreaterThanOrEqual(0);
    }
  });

  it("matches the manual TR seed", () => {
    const cs: CandleLike[] = [
      { openTime: 0, open: 10, high: 12, low: 9, close: 11, volume: 1 }, // idx0
      { openTime: 1, open: 11, high: 15, low: 10, close: 14, volume: 1 },
      { openTime: 2, open: 14, high: 16, low: 13, close: 15, volume: 1 },
    ];
    const out = atr(cs, 2);
    const tr1 = Math.max(15 - 10, Math.abs(15 - 11), Math.abs(10 - 11)); // 5
    const tr2 = Math.max(16 - 13, Math.abs(16 - 14), Math.abs(13 - 14)); // 3
    expect(out[2]).toBeCloseTo((tr1 + tr2) / 2, 10);
  });
});
