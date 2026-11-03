import { describe, expect, it } from "vite-plus/test";
import {
  parseBtcDominance,
  parseFearGreed,
  parseForceOrder,
  parseFuturesTickers,
  parseLongShortRatio,
  parseOpenInterestChange,
  parsePremiumIndex,
  sumLiquidations,
} from "../marketOverview";

describe("Binance futures parsers", () => {
  it("picks the requested symbols from the 24h ticker list", () => {
    const raw = [
      {
        symbol: "BTCUSDT",
        lastPrice: "68420.1",
        priceChangePercent: "2.10",
        quoteVolume: "1.2e10",
      },
      { symbol: "ETHUSDT", lastPrice: "bad", priceChangePercent: "1", quoteVolume: "1" },
      { symbol: "XYZUSDT", lastPrice: "1", priceChangePercent: "1", quoteVolume: "1" },
    ];
    expect(parseFuturesTickers(raw, ["BTC-USDT", "ETH-USDT", "SOL-USDT"])).toEqual([
      { symbol: "BTC-USDT", price: 68420.1, changePct: 2.1, quoteVolume: 1.2e10 },
    ]);
    expect(parseFuturesTickers({ code: -1 }, ["BTC-USDT"])).toEqual([]);
  });

  it("converts funding from a fraction to percent", () => {
    const m = parsePremiumIndex(
      [{ symbol: "BTCUSDT", lastFundingRate: "0.00010000", nextFundingTime: 1700000000000 }],
      ["BTC-USDT", "ETH-USDT"],
    );
    expect(m.get("BTC-USDT")?.fundingPct).toBeCloseTo(0.01, 12);
    expect(m.has("ETH-USDT")).toBe(false);
  });

  it("measures open-interest change and the long/short ratio", () => {
    expect(
      parseOpenInterestChange([{ sumOpenInterestValue: "100" }, { sumOpenInterestValue: "103.1" }]),
    ).toBeCloseTo(3.1, 10);
    expect(parseOpenInterestChange([])).toBeNull();
    expect(parseLongShortRatio([{ longShortRatio: "1.30" }, { longShortRatio: "1.42" }])).toBe(
      1.42,
    );
    expect(parseLongShortRatio("nope")).toBeNull();
  });
});

describe("sentiment parsers", () => {
  it("reads Fear & Greed today, yesterday and a week ago", () => {
    const data = [38, 44, 40, 41, 45, 50, 51, 52].map((v, i) => ({
      value: String(v),
      value_classification: i === 0 ? "Fear" : "x",
      timestamp: String(1_730_505_600 - i * 86_400),
    }));
    expect(parseFearGreed({ data })).toEqual({
      value: 38,
      label: "Fear",
      time: 1_730_505_600_000,
      yesterday: 44,
      lastWeek: 52,
    });
    expect(parseFearGreed({ data: [] })).toBeNull();
  });

  it("reads BTC dominance", () => {
    expect(parseBtcDominance({ data: { market_cap_percentage: { btc: 57.2 } } })).toBe(57.2);
    expect(parseBtcDominance({})).toBeNull();
  });
});

describe("liquidations", () => {
  it("maps a SELL force order to a long liquidation in USD", () => {
    const l = parseForceOrder({
      e: "forceOrder",
      o: { s: "BTCUSDT", S: "SELL", q: "0.5", p: "67900", ap: "68000", z: "0.5", T: 1000 },
    });
    expect(l).toEqual({ symbol: "BTC-USDT", side: "long", price: 68000, usd: 34000, time: 1000 });
    expect(parseForceOrder({ o: { s: "BTCUSD_PERP" } })).toBeNull();
  });

  it("sums by side within a window and finds the largest", () => {
    const list = [
      { symbol: "BTC-USDT", side: "long" as const, price: 1, usd: 500, time: 10 },
      { symbol: "ETH-USDT", side: "short" as const, price: 1, usd: 200, time: 20 },
      { symbol: "SOL-USDT", side: "long" as const, price: 1, usd: 900, time: 5 },
    ];
    const s = sumLiquidations(list, 8);
    expect(s.long).toBe(500);
    expect(s.short).toBe(200);
    expect(s.largest?.symbol).toBe("BTC-USDT");
  });
});
