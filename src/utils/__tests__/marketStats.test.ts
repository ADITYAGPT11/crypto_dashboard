import { describe, expect, it } from "vite-plus/test";
import type { Candle } from "../../types/marketData";
import {
  aboveEma,
  atrPct,
  changePct,
  correlation,
  correlationMatrix,
  layoutBubbles,
  logReturns,
  percentileRank,
  realizedVol,
  sessionsAt,
  topMovers,
  volRegime,
} from "../marketStats";

const H4 = 14_400_000;

function candles(closes: number[], start = 0): Candle[] {
  return closes.map((c, i) => ({
    openTime: start + i * H4,
    open: c,
    high: c * 1.01,
    low: c * 0.99,
    close: c,
    volume: 1,
  }));
}

describe("returns and volatility", () => {
  it("computes log returns", () => {
    expect(logReturns([100, 110, 99])[0]).toBeCloseTo(Math.log(1.1), 12);
    expect(logReturns([100])).toEqual([]);
  });

  it("annualises realised volatility", () => {
    // alternating ±1% moves: stdev ≈ 0.01005 per 4h bar
    const closes = [100];
    for (let i = 0; i < 42; i++) closes.push(closes[closes.length - 1] * (i % 2 ? 0.99 : 1.01));
    const vol = realizedVol(closes, 42, H4);
    const r = logReturns(closes);
    const m = r.reduce((s, v) => s + v, 0) / r.length;
    const sd = Math.sqrt(r.reduce((s, v) => s + (v - m) ** 2, 0) / (r.length - 1));
    expect(vol).toBeCloseTo(sd * Math.sqrt(2190) * 100, 8);
    expect(realizedVol([100, 101, 102], 10, H4)).toBeNaN();
  });

  it("is zero for a flat series", () => {
    expect(realizedVol(Array(50).fill(100), 42, H4)).toBe(0);
  });
});

describe("ATR, trend and change", () => {
  it("expresses ATR as a percent of price", () => {
    // high-low range is 2% of price every candle, no gaps
    expect(atrPct(candles(Array(30).fill(100)))).toBeCloseTo(2, 6);
    expect(atrPct(candles([1, 2, 3]))).toBeNaN();
  });

  it("detects the close above or below the EMA", () => {
    const up = Array.from({ length: 60 }, (_, i) => 100 + i);
    expect(aboveEma(up, 50)).toBe(true);
    expect(aboveEma([...up].reverse(), 50)).toBe(false);
    expect(aboveEma([1, 2], 50)).toBeNull();
  });

  it("computes percent change over n bars", () => {
    expect(changePct([100, 105, 110], 2)).toBeCloseTo(10, 12);
    expect(changePct([100], 2)).toBeNaN();
  });
});

describe("correlation", () => {
  it("is ±1 for linear series and NaN for a constant", () => {
    expect(correlation([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1, 12);
    expect(correlation([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1, 12);
    expect(correlation([1, 2, 3], [5, 5, 5])).toBeNaN();
  });

  it("aligns series on open time before correlating returns", () => {
    const a = [100, 102, 101, 104, 103, 107, 106];
    const b = a.map((x) => x * 2); // same returns
    const c = [100, 99, 101, 98, 100, 97, 99];
    const series = new Map([
      ["A", candles(a)],
      // B starts one candle later: alignment must use only shared times
      ["B", candles(b).slice(1)],
      ["C", candles(c)],
    ]);
    const m = correlationMatrix(series, 10);
    expect(m.symbols).toEqual(["A", "B", "C"]);
    expect(m.values[0][0]).toBe(1);
    expect(m.values[0][1]).toBeCloseTo(1, 10);
    expect(m.values[1][0]).toBeCloseTo(m.values[0][1], 12);
    expect(m.values[0][2]).toBeLessThan(0);
  });
});

describe("percentile and volatility regime", () => {
  it("ranks a value among others", () => {
    expect(percentileRank([1, 2, 3, 4], 3)).toBe(0.5);
    expect(percentileRank([], 1)).toBeNaN();
  });

  it("calls a quiet last week calm after a volatile year", () => {
    const closes = [100];
    // 400 days of ±3% swings, then 7 days of ±0.2%
    for (let i = 0; i < 400 * 6; i++)
      closes.push(closes[closes.length - 1] * (i % 2 ? 0.97 : 1.03));
    for (let i = 0; i < 7 * 6; i++)
      closes.push(closes[closes.length - 1] * (i % 2 ? 0.998 : 1.002));
    const res = volRegime(candles(closes), H4);
    expect(res?.regime).toBe("calm");
    expect(res?.percentile).toBe(0);
    expect(res?.samples).toBe(365);
  });

  it("needs enough history", () => {
    expect(volRegime(candles(Array(50).fill(1)), H4)).toBeNull();
  });
});

describe("sessions", () => {
  it("marks the London–New York overlap at 14:30 UTC", () => {
    const { hour, sessions } = sessionsAt(Date.UTC(2026, 10, 2, 14, 30));
    expect(hour).toBe(14.5);
    expect(sessions.filter((s) => s.isOpen).map((s) => s.name)).toEqual(["London", "New York"]);
  });

  it("marks only Asia at 03:00 UTC", () => {
    const open = sessionsAt(Date.UTC(2026, 10, 2, 3)).sessions.filter((s) => s.isOpen);
    expect(open.map((s) => s.name)).toEqual(["Asia"]);
  });
});

describe("topMovers", () => {
  it("returns gainers and losers without overlap", () => {
    const items = [3, -1, 5, -4, 0.5].map((change, i) => ({ id: i, change }));
    const { gainers, losers } = topMovers(items, 3);
    expect(gainers.map((g) => g.change)).toEqual([5, 3]);
    expect(losers.map((l) => l.change)).toEqual([-4, -1]);
  });
});

describe("layoutBubbles", () => {
  it("places every bubble inside the box without overlap, bigger weight = bigger bubble", () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ id: `c${i}`, weight: 100 / (i + 1) }));
    const bubbles = layoutBubbles(items, 800, 440);
    expect(bubbles).toHaveLength(10);
    for (const b of bubbles) {
      expect(b.x - b.r).toBeGreaterThanOrEqual(0);
      expect(b.x + b.r).toBeLessThanOrEqual(800);
      expect(b.y - b.r).toBeGreaterThanOrEqual(0);
      expect(b.y + b.r).toBeLessThanOrEqual(440);
    }
    for (let i = 0; i < bubbles.length; i++)
      for (let j = i + 1; j < bubbles.length; j++)
        expect(
          Math.hypot(bubbles[i].x - bubbles[j].x, bubbles[i].y - bubbles[j].y),
        ).toBeGreaterThanOrEqual(bubbles[i].r + bubbles[j].r);
    const r = new Map(bubbles.map((b) => [b.id, b.r]));
    expect(r.get("c0")!).toBeGreaterThan(r.get("c9")!);
  });

  it("ignores empty or zero weights", () => {
    expect(layoutBubbles([{ id: "a", weight: 0 }], 100, 100)).toEqual([]);
  });
});
