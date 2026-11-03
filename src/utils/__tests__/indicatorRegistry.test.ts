import { describe, expect, it } from "vite-plus/test";
import type { Candle } from "../../types/marketData";
import {
  computeInstance,
  DEFAULT_INDICATORS,
  INDICATORS,
  instanceTitle,
  newInstance,
  parseInstances,
} from "../indicatorRegistry";

const candles: Candle[] = Array.from({ length: 120 }, (_, i) => {
  const p = 100 + 10 * Math.sin(i / 7) + i * 0.1;
  return {
    openTime: i * 60_000,
    open: p - 0.5,
    high: p + 1,
    low: p - 1,
    close: p,
    volume: 100 + (i % 9) * 10,
  };
});

describe("indicator registry", () => {
  it("computes every indicator aligned to the candles with NaN warm-up", () => {
    for (const def of INDICATORS) {
      const inst = newInstance(def.id, def.id);
      const out = computeInstance(inst, candles);
      const warm = def.warmup(inst.params);
      for (const plot of def.plots) {
        expect([def.id, plot.key, out[plot.key].length]).toEqual([
          def.id,
          plot.key,
          candles.length,
        ]);
        if (warm > 0) expect(Number.isNaN(out[plot.key][warm - 1])).toBe(true);
        expect([def.id, plot.key, Number.isFinite(out[plot.key][candles.length - 1])]).toEqual([
          def.id,
          plot.key,
          true,
        ]);
      }
    }
  });

  it("matches a hand-computed simple moving average", () => {
    const inst = { ...newInstance("sma", "a"), params: { length: 3 } };
    const ma = computeInstance(inst, candles).ma;
    expect(ma[2]).toBeCloseTo((candles[0].close + candles[1].close + candles[2].close) / 3, 10);
    expect(Number.isNaN(ma[1])).toBe(true);
  });

  it("keeps RSI between 0 and 100 and MACD histogram = MACD − signal", () => {
    const r = computeInstance(newInstance("rsi", "r"), candles).rsi.filter(Number.isFinite);
    expect(Math.min(...r)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...r)).toBeLessThanOrEqual(100);
    const m = computeInstance(newInstance("macd", "m"), candles);
    const i = candles.length - 1;
    expect(m.hist[i]).toBeCloseTo(m.macd[i] - m.signal[i], 10);
  });

  it("titles instances like TradingView's legend", () => {
    expect(instanceTitle({ ...newInstance("ema", "e"), params: { length: 50 } })).toBe("EMA 50");
    expect(instanceTitle(newInstance("macd", "m"))).toBe("MACD 12 26 9");
    expect(instanceTitle(newInstance("obv", "o"))).toBe("OBV");
  });

  it("parses stored instances, clamping inputs and dropping unknowns", () => {
    const parsed = parseInstances([
      { uid: "a", id: "rsi", params: { length: 99999 }, colors: { rsi: "red" } },
      { uid: "b", id: "nope" },
      { uid: "a", id: "ema" },
      { uid: "c", id: "ema", visible: false },
    ]);
    expect(parsed.map((p) => p.uid)).toEqual(["a", "c"]);
    expect(parsed[0].params.length).toBe(500);
    expect(parsed[0].colors.rsi).toBe("#7E57C2");
    expect(parsed[1].visible).toBe(false);
    expect(parseInstances("junk")).toEqual(DEFAULT_INDICATORS);
  });
});
