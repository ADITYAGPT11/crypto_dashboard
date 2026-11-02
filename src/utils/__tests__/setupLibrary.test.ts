import { describe, expect, it } from "vite-plus/test";
import type { Outcome, SetupOccurrence, SetupStats, Verdict } from "../../types/analysis";
import type { Scan, SymbolAnalysis } from "../setupAnalysis";
import { filterAndSort, libraryTotals, parseSetupKey, perSymbolStats } from "../setupLibrary";

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

describe("perSymbolStats", () => {
  const outcome = (result: Outcome["result"]): Outcome => ({
    result,
    exitIndex: 1,
    movePct: result === "win" ? 3 : -1.5,
    r: result === "win" ? 2 : -1,
    bars: 3,
  });
  const occ = (symbol: string, result: Outcome["result"], time: number): SetupOccurrence => ({
    symbol,
    hit: { type: "hammer", index: time, entry: 100, stop: 98, target: 104, low: 98, points: [] },
    location: "demandZone",
    outcome: outcome(result),
    time,
  });
  const analysis = (symbol: string, occurrences: SetupOccurrence[]): SymbolAnalysis => ({
    symbol,
    zones: [],
    occurrences,
  });

  it("measures the setup per coin, most cases first, skipping coins without cases", () => {
    const btc = [occ("BTC", "win", 1), occ("BTC", "loss", 2)];
    const eth = [occ("ETH", "win", 3), occ("ETH", "win", 4), occ("ETH", "loss", 5)];
    const sol = [occ("SOL", "open", 6)];
    const scan: Scan = {
      analyses: new Map([
        ["BTC", analysis("BTC", btc)],
        ["ETH", analysis("ETH", eth)],
        ["SOL", analysis("SOL", sol)],
      ]),
      pooled: new Map([["hammer|demandZone", stats("hammer|demandZone", 5, 0.6, 0.8, "tooFew")]]),
      current: [],
    };
    scan.pooled.get("hammer|demandZone")!.type = "hammer";
    scan.pooled.get("hammer|demandZone")!.location = "demandZone";

    const rows = perSymbolStats(scan, "hammer|demandZone");
    expect(rows.map((r) => [r.symbol, r.stats.n, r.stats.wins])).toEqual([
      ["ETH", 3, 2],
      ["BTC", 2, 1],
    ]);
  });

  it("returns nothing for an unknown setup", () => {
    const scan: Scan = { analyses: new Map(), pooled: new Map(), current: [] };
    expect(perSymbolStats(scan, "nope")).toEqual([]);
  });
});

describe("parseSetupKey", () => {
  it("accepts known pattern|location keys", () => {
    expect(parseSetupKey("hammer|demandZone")).toEqual({ type: "hammer", location: "demandZone" });
  });
  it("rejects anything else", () => {
    for (const bad of [null, "", "hammer", "hammer|moon", "x|demandZone", "hammer|demandZone|x"]) {
      expect(parseSetupKey(bad)).toBeNull();
    }
  });
});
