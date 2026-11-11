import { describe, expect, it } from "vite-plus/test";
import type { Candle } from "../../types/marketData";
import type { LibraryEvent, LibraryStats } from "../../types/patternLibrary";
import {
  BackendOffline,
  PatternLibraryService,
  type LibraryEntry,
} from "../../services/PatternLibraryService";
import { eventId, libraryMarkers, listEvents, statsKey, toCiStats } from "../patternLibrary";

const H4 = 14_400_000;

function ev(pattern: string, t: number, over: Partial<LibraryEvent> = {}): LibraryEvent {
  return {
    pattern,
    label: pattern,
    kind: "chart",
    direction: "bullish",
    open_time: t,
    entry: 100,
    stop: 99,
    target: 102,
    atr: 1,
    outcome: { result: "win", exit_time: null, bars: 3, r: 2, move_pct: 2 },
    ...over,
  };
}

function candle(t: number): Candle {
  return { openTime: t, open: 1, high: 1, low: 1, close: 1, volume: 1 } as Candle;
}

describe("pattern library helpers", () => {
  it("lists current events first-class, newest first, without duplicates", () => {
    const a = ev("double_bottom", 5 * H4);
    const b = ev("hs_bottom", 3 * H4);
    const c = ev("flag_bull", 4 * H4, { direction: "bearish" });
    const rows = listEvents([a], [b, a, c], 10);
    expect(rows.map((r) => r.event.pattern)).toEqual(["double_bottom", "flag_bull", "hs_bottom"]);
    expect(rows.map((r) => r.isNow)).toEqual([true, false, false]);
    expect(listEvents([a], [b, c], 2)).toHaveLength(2);
  });

  it("keys stats by pattern and direction", () => {
    expect(statsKey("fakey_bullish", "bullish")).toBe("fakey_bullish|bullish");
    expect(eventId(ev("x", 7))).toBe("x|bullish|7");
  });

  it("maps cases to markers on the chart, pointing down for shorts", () => {
    const candles = [1, 2, 3, 4].map((i) => candle(i * H4));
    const sel = ev("double_top", 4 * H4, { direction: "bearish" });
    const cases = [
      ev("double_top", 2 * H4, { direction: "bearish" }),
      ev("double_top", 9 * H4, { direction: "bearish" }), // not on this chart
    ];
    const ms = libraryMarkers(cases, sel, candles);
    expect(ms).toEqual([
      { time: 2 * H4, result: "win", current: false, direction: "down" },
      { time: 4 * H4, result: "win", current: true, direction: "down" },
    ]);
  });

  it("shapes stats for the shared CI bar", () => {
    const s = { win_rate: 0.4, ci_low: 0.3, ci_high: 0.5, break_even: 1 / 3, n: 90 };
    expect(toCiStats(s as LibraryStats)).toEqual({
      winRate: 0.4,
      ci: [0.3, 0.5],
      breakEven: 1 / 3,
      n: 90,
    });
  });
});

describe("PatternLibraryService", () => {
  const patterns = { events: [], current: [], bracket: {} };
  const stats = { stats: [], symbols: ["BTC-USDT"], unavailable: [] };

  function make(fetcher: (url: string) => Promise<unknown>, now: { t: number }) {
    return new PatternLibraryService(fetcher, () => now.t);
  }

  it("fetches patterns and stats once, then again after a candle closes", async () => {
    const urls: string[] = [];
    const now = { t: 10 * H4 + 5 };
    const s = make(async (url) => {
      urls.push(url);
      return url.includes("/stats") ? stats : patterns;
    }, now);
    let notified = 0;
    s.subscribe(() => notified++);
    await s.load("BTC-USDT", "4h", "chart");
    expect(urls).toEqual([
      "/tcs/patterns/BTC-USDT/4h?kinds=chart",
      "/tcs/patterns/BTC-USDT/4h/stats?kinds=chart",
    ]);
    expect(s.get("BTC-USDT", "4h", "chart")?.status).toBe("ready");
    expect(notified).toBe(2); // loading, ready
    await s.load("BTC-USDT", "4h", "chart");
    expect(urls).toHaveLength(2);
    now.t = 11 * H4 + 1;
    await s.load("BTC-USDT", "4h", "chart");
    expect(urls).toHaveLength(4);
  });

  it("shares one request between concurrent callers", async () => {
    let calls = 0;
    const s = make(
      async (url) => {
        calls++;
        return url.includes("/stats") ? stats : patterns;
      },
      { t: 0 },
    );
    await Promise.all([s.load("ETH-USDT", "1h", "chart"), s.load("ETH-USDT", "1h", "chart")]);
    expect(calls).toBe(2);
  });

  it("reports offline vs error without rejecting", async () => {
    const off = make(
      async () => {
        throw new BackendOffline("connection refused");
      },
      { t: 0 },
    );
    await off.load("BTC-USDT", "4h", "chart");
    expect(off.get("BTC-USDT", "4h", "chart")?.status).toBe("offline");

    const bad = make(
      async () => {
        throw new Error("history unavailable");
      },
      { t: 0 },
    );
    await bad.load("BTC-USDT", "4h", "chart");
    const e = bad.get("BTC-USDT", "4h", "chart") as LibraryEntry;
    expect([e.status, e.error]).toEqual(["error", "history unavailable"]);

    const odd = make(async () => ({ nope: true }), { t: 0 });
    await odd.load("BTC-USDT", "4h", "chart");
    expect(odd.get("BTC-USDT", "4h", "chart")?.error).toBe("unexpected response");
  });
});
