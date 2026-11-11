import { describe, expect, it } from "vite-plus/test";
import {
  HistoryService,
  INTERVAL_MS,
  nextClose,
  toBinanceSymbol,
} from "../../services/HistoryService";

const H4 = INTERVAL_MS["4h"];

function row(t: number, price: number): [number, string, string, string, string, string] {
  return [t, String(price), String(price + 1), String(price - 1), String(price + 0.5), "10"];
}

describe("HistoryService", () => {
  it("maps symbols to Binance format", () => {
    expect(toBinanceSymbol("BTC-USDT")).toBe("BTCUSDT");
  });

  it("pages backwards, merges ascending, and drops the forming candle", async () => {
    const now = 10_000 * H4 + H4 / 2; // halfway through candle 10000
    const urls: string[] = [];
    const fetcher = async (url: string) => {
      urls.push(url);
      const end = url.includes("endTime=") ? Number(url.split("endTime=")[1]) : now;
      const lastOpen = Math.floor(end / H4) * H4;
      return Array.from({ length: 1500 }, (_, k) => row(lastOpen - (1499 - k) * H4, 100 + k));
    };
    const svc = new HistoryService(fetcher, () => now);
    const h = await svc.load("BTC-USDT", "4h", 2);
    expect(urls).toHaveLength(2);
    expect(urls[1]).toContain("endTime=");
    expect(h.candles).toHaveLength(2999); // 3000 fetched minus the forming candle
    for (let i = 1; i < h.candles.length; i++) {
      expect(h.candles[i].openTime - h.candles[i - 1].openTime).toBe(H4);
    }
    expect(h.candles[h.candles.length - 1].openTime + H4).toBeLessThanOrEqual(now);
  });

  it("caches successes and retries after a failure", async () => {
    let calls = 0;
    const fetcher = async () => {
      calls++;
      if (calls === 1) throw new Error("network");
      return [row(0, 100)];
    };
    const svc = new HistoryService(fetcher, () => 10 * H4);
    await expect(svc.load("ETH-USDT", "4h", 1)).rejects.toThrow("network");
    const a = await svc.load("ETH-USDT", "4h", 1);
    const b = await svc.load("ETH-USDT", "4h", 1);
    expect(a).toBe(b);
    expect(calls).toBe(2);
  });
});

describe("HistoryService refresh", () => {
  it("refetches once a newer candle has closed, not before", async () => {
    let calls = 0;
    let now = 10 * H4 + 60_000;
    const fetcher = async () => {
      calls++;
      return [row(0, 100)];
    };
    const svc = new HistoryService(fetcher, () => now);
    await svc.load("BTC-USDT", "4h", 1);
    now = 11 * H4 - 1; // same candle still forming
    await svc.load("BTC-USDT", "4h", 1);
    expect(calls).toBe(1);
    now = 11 * H4; // candle 10 just closed
    await svc.load("BTC-USDT", "4h", 1);
    expect(calls).toBe(2);
  });

  it("computes the next close time", () => {
    expect(nextClose(0, "4h")).toBe(H4);
    expect(nextClose(H4 + 5, "4h")).toBe(2 * H4);
  });

  it("closes weekly candles on Monday 00:00 UTC", () => {
    const wed = Date.UTC(2026, 10, 4, 12); // Wednesday 4 Nov 2026
    expect(new Date(nextClose(wed, "1w")).toISOString()).toBe("2026-11-09T00:00:00.000Z");
    const monday = Date.UTC(2026, 10, 9);
    expect(new Date(nextClose(monday, "1w")).toISOString()).toBe("2026-11-16T00:00:00.000Z");
  });
});

describe("HistoryService fallback", () => {
  it("uses the analysis service's candles when Binance fails", async () => {
    const fallbackCalls: string[] = [];
    const svc = new HistoryService(
      async () => {
        throw new Error("Binance history HTTP 451");
      },
      () => 3 * H4,
      async (symbol, tf, limit) => {
        fallbackCalls.push(`${symbol}|${tf}|${limit}`);
        return [0, 1, 2, 3].map((i) => ({
          openTime: i * H4,
          open: 1,
          high: 2,
          low: 0.5,
          close: 1.5,
          volume: 10,
        }));
      },
    );
    const h = await svc.load("BTC-USDT", "4h", 1);
    expect(fallbackCalls).toEqual(["BTC-USDT|4h|1500"]);
    expect(h.candles.map((c) => c.openTime)).toEqual([0, H4, 2 * H4]); // forming candle dropped
  });

  it("reports the exchange's error when the fallback fails too", async () => {
    const svc = new HistoryService(
      async () => {
        throw new Error("network");
      },
      () => 0,
      async () => {
        throw new Error("service offline");
      },
    );
    await expect(svc.load("BTC-USDT", "4h", 1)).rejects.toThrow("network");
  });
});
