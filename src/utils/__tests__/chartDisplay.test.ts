import { describe, expect, it } from "vite-plus/test";
import type { Candle } from "../../types/marketData";
import {
  heikinAshi,
  parseChartPrefs,
  tfLabel,
  tfLongLabel,
  DEFAULT_CHART_PREFS,
} from "../chartDisplay";

const c = (open: number, high: number, low: number, close: number): Candle => ({
  openTime: 0,
  open,
  high,
  low,
  close,
  volume: 1,
});

describe("heikinAshi", () => {
  it("averages prices and chains opens", () => {
    const ha = heikinAshi([c(10, 14, 8, 12), c(12, 15, 11, 14)]);
    expect(ha[0].close).toBe(11);
    expect(ha[0].open).toBe(11);
    expect(ha[1].open).toBe(11); // midpoint of previous HA open/close
    expect(ha[1].close).toBe(13);
    expect(ha[1].high).toBe(15);
    expect(ha[1].low).toBe(11);
  });
});

describe("timeframe labels", () => {
  it("uses TradingView's short and long names", () => {
    expect(tfLabel("1d")).toBe("D");
    expect(tfLabel("1w")).toBe("W");
    expect(tfLabel("15m")).toBe("15m");
    expect(tfLongLabel("15m")).toBe("15 minutes");
    expect(tfLongLabel("1h")).toBe("1 hour");
    expect(tfLongLabel("1w")).toBe("1 week");
  });
});

describe("parseChartPrefs", () => {
  it("keeps valid values and falls back otherwise", () => {
    expect(
      parseChartPrefs({ favorites: ["1h", "7m", "1d"], chartType: "area", scale: "log" }),
    ).toEqual({
      favorites: ["1h", "1d"],
      chartType: "area",
      scale: "log",
    });
    expect(parseChartPrefs(null)).toEqual(DEFAULT_CHART_PREFS);
  });
});
