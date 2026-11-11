import { describe, expect, it } from "vite-plus/test";
import type { CatalogOut } from "../../api/schema";
import {
  activeTfs,
  DEFAULT_DETECTION,
  parseDetection,
  tfsFor,
  zoneTfFor,
} from "../detectionConfig";

const catalog = {
  ruleset: "r1",
  patterns: [
    {
      id: "doubleBottom",
      label: "Double bottom",
      kind: "chart",
      bias: "long",
      source: "",
      summary: "",
    },
    { id: "hammer", label: "Hammer", kind: "candlestick", bias: "long", source: "", summary: "" },
  ],
  maxHoldBars: 30,
  minSample: 30,
  timeframes: ["1h", "4h", "1d"],
  universe: [],
} satisfies CatalogOut;

describe("detection config", () => {
  it("never takes zones from a lower timeframe than the pattern", () => {
    expect(zoneTfFor("4h", "1d")).toBe("1d");
    expect(zoneTfFor("1d", "4h")).toBe("1d");
    expect(zoneTfFor("1h", "same")).toBe("1h");
  });

  it("uses each kind's default until the user picks", () => {
    expect(tfsFor(DEFAULT_DETECTION, catalog.patterns[0])).toEqual(["4h", "1d"]);
    expect(tfsFor(DEFAULT_DETECTION, catalog.patterns[1])).toEqual(["4h"]);
    expect(activeTfs(DEFAULT_DETECTION, catalog)).toEqual(["4h", "1d"]);
    const picked = {
      patterns: { doubleBottom: [], hammer: ["1h" as const] },
      zones: "same" as const,
    };
    expect(activeTfs(picked, catalog)).toEqual(["1h"]);
    expect(activeTfs(picked, null)).toEqual([]);
  });

  it("parses stored values, dropping unknown timeframes and junk ids", () => {
    expect(
      parseDetection({
        patterns: { hammer: ["5m", "1d"], doubleBottom: [], "bad id": ["1h"] },
        zones: "4h",
      }),
    ).toEqual({ patterns: { doubleBottom: [], hammer: ["1d"] }, zones: "4h" });
    expect(parseDetection("junk")).toEqual(DEFAULT_DETECTION);
  });
});
