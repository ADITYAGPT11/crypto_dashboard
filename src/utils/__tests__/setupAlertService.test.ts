import { describe, expect, it, vi } from "vite-plus/test";
import type { SetupOccurrence } from "../../types/analysis";
import type { CurrentSetup } from "../setupAlerts";
import { SetupAlertService } from "../../services/SetupAlertService";

const H4 = 14_400_000;

function occurrence(time: number): SetupOccurrence {
  return {
    symbol: "BTC-USDT",
    pattern: "hammer",
    direction: "long",
    location: "zone",
    time,
    startTime: time,
    close: 100,
    extreme: 98,
    points: [],
    lines: [],
    score: 1,
    checks: [
      {
        id: "location",
        label: "At a bullish order block / demand zone",
        passed: true,
        detail: "at a zone",
      },
      { id: "rsi", label: "RSI 50-70: healthy momentum", passed: false, detail: "RSI 44" },
    ],
  };
}

function currentWith(time: number): CurrentSetup[] {
  return [{ occurrence: occurrence(time) }];
}

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

describe("SetupAlertService", () => {
  it("fires once and delivers the checklist to Telegram", async () => {
    let now = 100 * H4;
    const current = currentWith(101 * H4);
    const sig = "a";
    const request = vi.fn(async (path: string, _init?: RequestInit) =>
      path === "/alerts/send" ? { success: true } : { configured: true },
    );
    const storage = memoryStorage();
    const svc = new SetupAlertService({
      scanFor: async () => ({ current, sig }),
      request,
      watchlist: () => [],
      now: () => now,
      storage,
    });

    svc.addRule({
      symbol: "BTC-USDT",
      setupKey: "hammer|demandZone",
      interval: "4h",
      telegram: true,
      inApp: true,
    });
    await svc.check();
    now = 102 * H4;
    await svc.check(); // same history signature: no duplicate
    expect(svc.getSnapshot().firings).toHaveLength(1);
    expect(svc.getSnapshot().firings[0]).toMatchObject({ telegram: "sent", score: 1, of: 2 });
    const sends = request.mock.calls.filter(([p]) => p === "/alerts/send");
    expect(sends).toHaveLength(1);
    expect(sends[0][1]?.body as string).toContain("1/2");
    expect(sends[0][1]?.body as string).toContain("At a bullish order block / demand zone");

    // Rules and firings persist for the next session.
    const reloaded = new SetupAlertService({ storage, scanFor: async () => ({ current, sig }) });
    expect(reloaded.getSnapshot().rules).toHaveLength(1);
    expect(reloaded.getSnapshot().firings[0]).toMatchObject({ score: 1, of: 2 });
  });

  it("marks delivery offline when the backend is unreachable", async () => {
    const svc = new SetupAlertService({
      scanFor: async () => ({ current: currentWith(101 * H4), sig: "x" }),
      request: async () => {
        throw new Error("ECONNREFUSED");
      },
      watchlist: () => [],
      now: () => 100 * H4,
      storage: memoryStorage(),
    });
    svc.addRule({
      symbol: "BTC-USDT",
      setupKey: "hammer|demandZone",
      interval: "4h",
      telegram: true,
      inApp: false,
    });
    await svc.check();
    expect(svc.getSnapshot().firings[0].telegram).toBe("offline");
    expect(svc.getSnapshot().telegram).toBe("offline");
    expect(await svc.refreshTelegramStatus()).toBe("offline");
  });
});
