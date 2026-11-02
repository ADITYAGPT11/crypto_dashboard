import { describe, expect, it } from "vite-plus/test";
import { ArbitrageService } from "../../services/ArbitrageService";
import type { ArbitrageOpportunity } from "../../types/marketData";
import { fundingUnitsVerified, quoteCurrency } from "../symbolUtils";

describe("quote currency", () => {
  it("knows Delta is USD-quoted and its funding units are unverified", () => {
    expect(quoteCurrency("DELTA")).toBe("USD");
    expect(quoteCurrency("BINANCE")).toBe("USDT");
    expect(fundingUnitsVerified("DELTA")).toBe(false);
    expect(fundingUnitsVerified("OKX")).toBe(true);
  });
});

describe("ArbitrageService quote mixing", () => {
  it("never compares a USD-quoted price with USDT prices", () => {
    const arb = new ArbitrageService({ thresholdPercent: 0 });
    const seen: ArbitrageOpportunity[] = [];
    arb.on("arbitrage", (o: ArbitrageOpportunity) => seen.push(o));
    const tick = (exchange: "BINANCE" | "OKX" | "DELTA", price: number, quote?: "USD") =>
      arb.onPriceUpdate({
        exchange,
        symbol: "BTC-USDT",
        type: "FUT",
        currentPrice: price,
        timeStamp: 1,
        quote,
      });
    tick("BINANCE", 100);
    tick("DELTA", 103, "USD");
    expect(seen).toEqual([]);
    tick("OKX", 101);
    expect(seen).toHaveLength(1);
    expect(seen[0].lowest.exchange).toBe("BINANCE");
    expect(seen[0].highest.exchange).toBe("OKX");
  });
});
