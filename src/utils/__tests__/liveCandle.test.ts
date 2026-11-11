import { describe, expect, it } from "vite-plus/test";
import type { Candle } from "../../types/marketData";
import { LIVE_STALE_MS, pickLive } from "../liveCandle";
import { toOkxBar } from "../../adapters/OkxAdapter";
import { toCanonicalInterval } from "../candleUtils";

const c = (close: number): Candle => ({ openTime: 0, open: 1, high: 2, low: 0, close, volume: 1 });

describe("pickLive", () => {
  const now = 100_000;
  it("prefers Binance while it ticks", () => {
    const r = pickLive(
      { BINANCE: { candle: c(1), at: now - 1_000 }, OKX: { candle: c(2), at: now } },
      now,
    );
    expect(r).toMatchObject({ source: "BINANCE", candle: { close: 1 } });
  });

  it("falls back to OKX when Binance is silent", () => {
    const r = pickLive(
      {
        BINANCE: { candle: c(1), at: now - LIVE_STALE_MS - 1 },
        OKX: { candle: c(2), at: now - 500 },
      },
      now,
    );
    expect(r?.source).toBe("OKX");
    expect(pickLive({ BINANCE: null, OKX: { candle: c(2), at: now } }, now)?.source).toBe("OKX");
  });

  it("keeps the freshest stale candle, and nothing before any tick", () => {
    const r = pickLive({ BINANCE: { candle: c(1), at: 10 }, OKX: { candle: c(2), at: 20 } }, now);
    expect(r?.source).toBe("OKX");
    expect(pickLive({ BINANCE: null, OKX: null }, now)).toBeNull();
  });
});

describe("OKX bars", () => {
  it("uses UTC-aligned bars for days and weeks, plain ones for hours", () => {
    expect(toOkxBar("1h")).toBe("1H");
    expect(toOkxBar("4h")).toBe("4H");
    expect(toOkxBar("1d")).toBe("1Dutc");
    expect(toOkxBar("1w")).toBe("1Wutc");
    expect(toOkxBar("15m")).toBe("15m");
    expect(toCanonicalInterval("1Dutc")).toBe("1d");
    expect(toCanonicalInterval("4H")).toBe("4h");
  });
});
