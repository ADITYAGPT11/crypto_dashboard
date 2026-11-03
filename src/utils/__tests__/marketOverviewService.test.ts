import { describe, expect, it } from "vite-plus/test";
import { MarketOverviewService } from "../../services/MarketOverviewService";

describe("MarketOverviewService", () => {
  it("loads each source independently and marks failures unavailable", async () => {
    const fetcher = async (url: string) => {
      if (url.includes("ticker/24hr"))
        return [{ symbol: "BTCUSDT", lastPrice: "1", priceChangePercent: "2", quoteVolume: "3" }];
      if (url.includes("premiumIndex")) return [{ symbol: "BTCUSDT", lastFundingRate: "0.0001" }];
      if (url.includes("openInterestHist"))
        return [{ sumOpenInterestValue: "100" }, { sumOpenInterestValue: "110" }];
      if (url.includes("LongShort")) return [{ longShortRatio: "1.5" }];
      throw new Error("blocked");
    };
    const svc = new MarketOverviewService(["BTC-USDT"], fetcher, () => 42, false);
    await Promise.all([
      svc.refreshTickers(),
      svc.refreshDerivatives(),
      svc.refreshFearGreed(),
      svc.refreshDominance(),
    ]);
    const s = svc.getSnapshot();
    expect(s.tickers).toMatchObject({ state: "ok", updatedAt: 42 });
    expect(s.tickers.value[0].changePct).toBe(2);
    expect(s.funding.value.get("BTC-USDT")?.fundingPct).toBeCloseTo(0.01, 12);
    expect(s.openInterest.value.get("BTC-USDT")).toBeCloseTo(10, 10);
    expect(s.longShort.value.get("BTC-USDT")).toBe(1.5);
    expect(s.fearGreed.state).toBe("unavailable");
    expect(s.btcDominance.state).toBe("unavailable");
  });

  it("keeps the last good value when a later read fails", async () => {
    let fail = false;
    const svc = new MarketOverviewService(
      ["BTC-USDT"],
      async () => {
        if (fail) throw new Error("down");
        return { data: { market_cap_percentage: { btc: 57 } } };
      },
      () => 1,
      false,
    );
    await svc.refreshDominance();
    fail = true;
    await svc.refreshDominance();
    expect(svc.getSnapshot().btcDominance).toMatchObject({ state: "unavailable", value: 57 });
  });

  it("collects liquidations and drops ones older than 24 hours", () => {
    let now = 100 * 3_600_000;
    const svc = new MarketOverviewService(
      ["BTC-USDT"],
      async () => [],
      () => now,
      false,
    );
    const msg = (T: number) => ({ o: { s: "BTCUSDT", S: "SELL", ap: "10", z: "2", T } });
    svc.addLiquidationMessage(msg(now - 25 * 3_600_000)); // already too old
    svc.addLiquidationMessage(msg(now - 23 * 3_600_000));
    expect(svc.getSnapshot().liquidations.list).toHaveLength(1);
    now += 2 * 3_600_000; // the earlier one is now older than 24h
    svc.addLiquidationMessage(msg(now));
    expect(svc.getSnapshot().liquidations.list).toHaveLength(1);
    expect(svc.getSnapshot().liquidations.list[0].usd).toBe(20);
  });
});
