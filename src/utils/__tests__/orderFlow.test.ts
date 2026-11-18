import { describe, expect, it } from "vite-plus/test";
import type { Candle, TradeEvent } from "../../types/marketData";
import { toCandle } from "../candleUtils";
import {
  BigTradeDetector,
  bubbleRadius,
  candleDelta,
  cumulativeDelta,
  quantileOf,
  timeToLogical,
} from "../orderFlow";

const candle = (openTime: number, volume: number, takerBuyVolume?: number): Candle => ({
  openTime,
  open: 10,
  high: 11,
  low: 9,
  close: 10.5,
  volume,
  ...(takerBuyVolume !== undefined ? { takerBuyVolume } : {}),
});

const trade = (
  timeStamp: number,
  price: number,
  quantity: number,
  side: "buy" | "sell" = "buy",
): TradeEvent => ({
  exchange: "BINANCE",
  symbol: "BTC-USDT",
  type: "FUT",
  price,
  quantity,
  buyerMaker: side === "sell",
  timeStamp,
});

describe("delta and CVD", () => {
  it("delta is aggressive buys minus aggressive sells", () => {
    expect(candleDelta(candle(0, 100, 70))).toBe(40); // 70 bought, 30 sold
    expect(candleDelta(candle(0, 100, 20))).toBe(-60);
    expect(Number.isNaN(candleDelta(candle(0, 100)))).toBe(true);
  });

  it("CVD sums delta and skips candles without taker volume", () => {
    const cvd = cumulativeDelta([candle(0, 10, 6), candle(1, 10), candle(2, 10, 2)]);
    expect(cvd[0]).toBe(2);
    expect(Number.isNaN(cvd[1])).toBe(true);
    expect(cvd[2]).toBe(2 - 6);
  });

  it("toCandle keeps a valid taker volume and drops an impossible one", () => {
    const base = { openTime: 0, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 };
    expect(toCandle({ ...base, takerBuyVolume: 4 })?.takerBuyVolume).toBe(4);
    expect(toCandle({ ...base, takerBuyVolume: 11 })?.takerBuyVolume).toBeUndefined();
    expect(toCandle({ ...base, takerBuyVolume: Number.NaN })?.takerBuyVolume).toBeUndefined();
    expect("takerBuyVolume" in (toCandle(base) ?? {})).toBe(false);
  });
});

describe("BigTradeDetector", () => {
  const opts = { warmup: 10, sampleSize: 100, recomputeEvery: 1, minNotional: 0, quantile: 0.9 };

  /** Flags any order bigger than a tiny first one. */
  const eager = () => {
    const d = new BigTradeDetector({ ...opts, warmup: 1, quantile: 0 });
    d.push(trade(0, 1, 0.001));
    return d;
  };

  it("merges the fills of one taker order (same time and side) into one print", () => {
    const d = eager();
    expect(d.push(trade(1, 100, 1))).toBeNull();
    expect(d.push(trade(1, 101, 3))).toBeNull(); // same order, next price level
    const done = d.push(trade(2, 100, 1)); // a new order closes the previous one
    expect(done).toEqual({ time: 1, price: 100.75, quantity: 4, notional: 403, side: "buy" });
  });

  it("splits orders by side even at the same timestamp", () => {
    const d = eager();
    d.push(trade(1, 100, 1, "buy"));
    expect(d.push(trade(1, 100, 2, "sell"))?.side).toBe("buy");
    expect(d.flush()?.side).toBe("sell");
  });

  it("flags nothing while warming up, then only the top of the distribution", () => {
    const d = new BigTradeDetector(opts);
    const flagged: number[] = [];
    for (let i = 0; i < 200; i++) {
      const b = d.push(trade(i, 100, i % 20 === 5 ? 50 : 1)); // 5% of orders are big
      if (b) flagged.push(b.time);
    }
    expect(d.threshold).toBe(100);
    expect(flagged).not.toContain(5); // closed before 10 orders were seen
    expect(flagged).toContain(25);
    for (const t of flagged) expect(t % 20).toBe(5);
  });

  it("never flags below the notional floor", () => {
    const d = new BigTradeDetector({ ...opts, minNotional: 1e9 });
    for (let i = 0; i < 50; i++) expect(d.push(trade(i, 100, i % 10 === 9 ? 50 : 1))).toBeNull();
    expect(d.threshold).toBe(1e9);
  });

  it("ignores empty or invalid trades", () => {
    const d = new BigTradeDetector({ ...opts, warmup: 1, quantile: 0 });
    expect(d.push(trade(1, 0, 1))).toBeNull();
    expect(d.push(trade(1, 100, 0))).toBeNull();
    expect(d.flush()).toBeNull();
  });
});

describe("helpers", () => {
  it("quantile by nearest rank", () => {
    expect(quantileOf([5, 1, 4, 2, 3], 0.5)).toBe(3);
    expect(quantileOf([5, 1, 4, 2, 3], 1)).toBe(5);
    expect(quantileOf([5, 1, 4, 2, 3], 0)).toBe(1);
    expect(Number.isNaN(quantileOf([], 0.5))).toBe(true);
  });

  it("bubble area grows with notional and is capped", () => {
    expect(bubbleRadius(100, 100)).toBe(3);
    expect(bubbleRadius(400, 100)).toBe(6);
    expect(bubbleRadius(1e12, 100)).toBe(18);
  });

  it("places times on the bars, including the forming ones", () => {
    const H = 3_600_000;
    const cs = [candle(0, 1), candle(H, 1), candle(3 * H, 1)]; // a gap at 2H
    expect(timeToLogical(cs, -1, H)).toBeNull();
    expect(timeToLogical(cs, 0, H)).toBe(-0.5);
    expect(timeToLogical(cs, H + H / 2, H)).toBe(1);
    expect(timeToLogical(cs, 2 * H + 10, H)).toBe(1.5); // inside the gap: end of bar 1
    expect(timeToLogical(cs, 4 * H + H / 4, H)).toBe(2.75); // forming bar 3
  });
});
