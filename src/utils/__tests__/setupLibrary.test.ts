import { describe, expect, it } from "vite-plus/test";
import type { StatsOut, SummaryOut } from "../../api/schema";
import type { SetupStats, Verdict } from "../../types/analysis";
import { filterAndSort, libraryTotals, statsByKey } from "../setupLibrary";
import { locationLabel, normalizeSetupKey, parseSetupKey, setupKey } from "../setupKeys";

function stats(key: string, n: number, winRate: number, expectancyR: number, verdict: Verdict) {
  return { key, n, winRate, expectancyR, verdict } as SetupStats;
}

const LIB = [
  stats("a", 200, 0.6, 0.5, "edge"),
  stats("b", 40, 0.45, -0.1, "noEdge"),
  stats("c", 12, 0.7, 0.9, "tooFew"),
  stats("d", 90, 0.52, 0.2, "noEdge"),
];

describe("filterAndSort", () => {
  it("sorts by n, win rate or expectancy, highest first", () => {
    expect(filterAndSort(LIB, "all", "n").map((s) => s.key)).toEqual(["a", "d", "b", "c"]);
    expect(filterAndSort(LIB, "all", "winRate").map((s) => s.key)).toEqual(["c", "a", "d", "b"]);
    expect(filterAndSort(LIB, "all", "expectancy").map((s) => s.key)).toEqual(["c", "a", "d", "b"]);
  });

  it("filters by verdict without mutating the input", () => {
    expect(filterAndSort(LIB, "noEdge", "n").map((s) => s.key)).toEqual(["d", "b"]);
    expect(LIB.map((s) => s.key)).toEqual(["a", "b", "c", "d"]);
  });
});

describe("libraryTotals", () => {
  it("counts setups, resolved cases and verdicts", () => {
    expect(libraryTotals(LIB)).toEqual({ setups: 4, resolved: 342, edge: 1, tooFew: 1 });
  });
});

describe("statsByKey", () => {
  const summary: SummaryOut = {
    n: 40,
    wins: 22,
    losses: 18,
    expired: 3,
    open: 1,
    winRate: 0.55,
    ciLow: 0.4,
    ciHigh: 0.69,
    breakEven: 0.4,
    avgWinPct: 3,
    avgLossPct: -2,
    expectancyR: 0.2,
    medianBars: 6,
    verdict: "noEdge",
  };
  it("keys the backend's setups and maps the Wilson range", () => {
    const body = {
      setups: [
        { pattern: "hammer", direction: "long", location: "zone", summary },
        { pattern: "hammer", direction: "long", location: "*", summary },
        { pattern: "x", direction: "long", location: "nowhere", summary },
      ],
    } as StatsOut;
    const m = statsByKey(body);
    expect([...m.keys()]).toEqual(["hammer|long|zone", "hammer|long|*"]);
    expect(m.get("hammer|long|zone")).toMatchObject({ n: 40, ci: [0.4, 0.69], verdict: "noEdge" });
    expect(statsByKey(null).size).toBe(0);
  });
});

describe("setup keys", () => {
  it("round-trips and rejects junk", () => {
    expect(parseSetupKey(setupKey("doubleTop", "short", "confluence"))).toEqual({
      pattern: "doubleTop",
      direction: "short",
      location: "confluence",
    });
    expect(parseSetupKey("doubleTop|sideways|zone")).toBeNull();
    expect(parseSetupKey("doubleTop|short|nowhere")).toBeNull();
    expect(parseSetupKey("a b|long|zone")).toBeNull();
    expect(parseSetupKey("")).toBeNull();
  });

  it("upgrades keys stored before directions existed", () => {
    expect(normalizeSetupKey("doubleBottom|demandZone")).toBe("doubleBottom|long|zone");
    expect(normalizeSetupKey("hammer|openSpace")).toBe("hammer|long|openSpace");
    expect(normalizeSetupKey("tweezersBottom|openSpace")).toBeNull(); // retired pattern
  });

  it("names locations by direction", () => {
    expect(locationLabel("zone", "long")).toBe("in demand zone");
    expect(locationLabel("zone", "short")).toBe("in supply zone");
    expect(locationLabel("orderBlock", "short")).toBe("at bearish order block");
  });
});
