import { describe, expect, it } from "vite-plus/test";
import type { Candle } from "../../types/marketData";
import { activeTfs, DEFAULT_DETECTION, parseDetection, zoneTfFor } from "../detectionConfig";
import { SetupStatsService } from "../../services/SetupStatsService";
import { TF_MS } from "../timeframeMapping";

describe("detection config", () => {
  it("never takes zones from a lower timeframe than the pattern", () => {
    expect(zoneTfFor("4h", "1d")).toBe("1d");
    expect(zoneTfFor("1d", "4h")).toBe("1d");
    expect(zoneTfFor("1h", "same")).toBe("1h");
  });

  it("lists the timeframes in use", () => {
    expect(activeTfs(DEFAULT_DETECTION)).toEqual(["1h", "4h", "1d"]);
    expect(
      activeTfs({
        patterns: {
          doubleBottom: ["1d"],
          bullishEngulfing: [],
          hammer: ["1d"],
          invertedHammer: [],
          bullishHarami: [],
          tweezersBottom: [],
          threeWhiteSoldiers: [],
        },
        zones: "same",
      }),
    ).toEqual(["1d"]);
  });

  it("parses stored values, dropping unknown timeframes", () => {
    expect(
      parseDetection({ patterns: { hammer: ["5m", "1d"], doubleBottom: [] }, zones: "4h" }),
    ).toEqual({
      patterns: { ...DEFAULT_DETECTION.patterns, doubleBottom: [], hammer: ["1d"] },
      zones: "4h",
    });
    expect(parseDetection("junk")).toEqual(DEFAULT_DETECTION);
  });
});

describe("SetupStatsService", () => {
  /** Waves plus a strong high-volume up candle every 40 bars: yields patterns and zones. */
  const wave = (ms: number, n: number, seed: number): Candle[] =>
    Array.from({ length: n }, (_, i) => {
      const j = i + seed;
      const p = 100 + 8 * Math.sin(j / 9) + 3 * Math.sin(j / 2.3);
      const c: Candle = {
        openTime: i * ms,
        open: p - 0.3,
        high: p + 1 + (j % 5) * 0.4,
        low: p - 1 - (j % 7) * 0.3,
        close: p,
        volume: 100 + ((j * 37) % 200),
      };
      if (j % 40 === 21)
        Object.assign(c, { open: p - 7, low: p - 7.2, high: p + 0.2, volume: 900 });
      return c;
    });

  it("computes priority contexts first and pools every coin", async () => {
    const loads: string[] = [];
    const svc = new SetupStatsService(
      () => ["AAA-USDT", "BBB-USDT"],
      async (symbol, tf) => {
        loads.push(`${tf}:${symbol}`);
        return wave(TF_MS[tf], 400, symbol === "AAA-USDT" ? 0 : 17);
      },
      () => 0,
    );
    let notified = 0;
    svc.subscribe(() => notified++);
    svc.request({ patternTf: "1h", zoneTf: "1h" });
    svc.request({ patternTf: "4h", zoneTf: "1d" }, true); // same tick: must still go first
    await svc.idle();

    const a = svc.get({ patternTf: "4h", zoneTf: "1d" })!;
    const b = svc.get({ patternTf: "1h", zoneTf: "1h" })!;
    expect(a).toMatchObject({ state: "done", done: 2, total: 2, failed: [] });
    expect(b.state).toBe("done");
    expect(a.pooled.size).toBeGreaterThan(0);
    expect(loads[0]).toBe("4h:AAA-USDT"); // the priority context ran first
    expect(loads).toContain("1d:AAA-USDT"); // zones loaded from 1d
    expect(notified).toBeGreaterThan(3);
  });

  it("records coins that fail and still finishes", async () => {
    const svc = new SetupStatsService(
      () => ["OK-USDT", "BAD-USDT"],
      async (symbol, tf) => {
        if (symbol === "BAD-USDT") throw new Error("down");
        return wave(TF_MS[tf], 300, 3);
      },
      () => 0,
    );
    svc.request({ patternTf: "4h", zoneTf: "4h" }, true);
    await svc.idle();
    expect(svc.get({ patternTf: "4h", zoneTf: "4h" })).toMatchObject({
      state: "done",
      failed: ["BAD-USDT"],
    });
  });

  it("does not recompute a fresh context but does once a new candle closed", async () => {
    let now = 10;
    let calls = 0;
    const svc = new SetupStatsService(
      () => ["A-USDT"],
      async (_s, tf) => {
        calls++;
        return wave(TF_MS[tf], 200, 1);
      },
      () => now,
    );
    const ctx = { patternTf: "4h" as const, zoneTf: "4h" as const };
    svc.request(ctx, true);
    await svc.idle();
    svc.request(ctx, true);
    await svc.idle();
    expect(calls).toBe(1);
    now = TF_MS["4h"] + 1;
    svc.request(ctx, true);
    await svc.idle();
    expect(calls).toBe(2);
  });
});
