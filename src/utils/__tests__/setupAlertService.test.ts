import { describe, expect, it, vi } from "vite-plus/test";
import type { SetupOccurrence, SetupStats } from "../../types/analysis";
import type { CurrentSetup } from "../setupAlerts";
import { SetupAlertService } from "../../services/SetupAlertService";

const H4 = 14_400_000;

function occurrence(time: number, result: SetupOccurrence["outcome"]["result"]): SetupOccurrence {
  return {
    symbol: "BTC-USDT",
    pattern: "hammer",
    direction: "long",
    location: "zone",
    time,
    startTime: time,
    entry: 100,
    stop: 98,
    target: 103,
    extreme: 98,
    points: [],
    lines: [],
    outcome: { result, exitTime: null, movePct: 0, r: 0, bars: 0 },
  };
}

const pooled = { n: 40, wins: 22, winRate: 0.55, ci: [0.4, 0.69], verdict: "noEdge" } as SetupStats;

function currentWith(time: number, result: SetupOccurrence["outcome"]["result"]): CurrentSetup[] {
  return result === "open" ? [{ occurrence: occurrence(time, result), pooled }] : [];
}

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

describe("SetupAlertService", () => {
  it("fires once, delivers to Telegram, then tracks the outcome", async () => {
    let now = 100 * H4;
    let current = currentWith(101 * H4, "open");
    let later = [occurrence(101 * H4, "open")];
    let sig = "a";
    const request = vi.fn(async (path: string, _init?: RequestInit) =>
      path === "/alerts/send" ? { success: true } : { configured: true },
    );
    const storage = memoryStorage();
    const svc = new SetupAlertService({
      scanFor: async () => ({ current, sig }),
      occurrencesFor: async () => later,
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
      edgeOnly: false,
    });
    await svc.check();
    now = 102 * H4;
    await svc.check(); // same history signature: no duplicate
    expect(svc.getSnapshot().firings).toHaveLength(1);
    expect(svc.getSnapshot().firings[0]).toMatchObject({ telegram: "sent", outcome: "open" });
    const sends = request.mock.calls.filter(([p]) => p === "/alerts/send");
    expect(sends).toHaveLength(1);
    expect(sends[0][1]?.body as string).toContain("22 of 40 won");

    current = currentWith(101 * H4, "win");
    later = [occurrence(101 * H4, "win")];
    sig = "b";
    await svc.check();
    expect(svc.getSnapshot().firings[0].outcome).toBe("win");

    // Rules and firings persist for the next session.
    const reloaded = new SetupAlertService({ storage, scanFor: async () => ({ current, sig }) });
    expect(reloaded.getSnapshot().rules).toHaveLength(1);
    expect(reloaded.getSnapshot().firings[0].outcome).toBe("win");
  });

  it("marks delivery offline when the backend is unreachable", async () => {
    const svc = new SetupAlertService({
      scanFor: async () => ({ current: currentWith(101 * H4, "open"), sig: "x" }),
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
      edgeOnly: false,
    });
    await svc.check();
    expect(svc.getSnapshot().firings[0].telegram).toBe("offline");
    expect(svc.getSnapshot().telegram).toBe("offline");
    expect(await svc.refreshTelegramStatus()).toBe("offline");
  });
});
