import { describe, expect, it } from "vite-plus/test";
import type { CatalogOut } from "../../api/schema";
import {
  DEFAULT_DETECTION,
  parseDetection,
  shownIds,
  shownPatterns,
  toggleTf,
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
  it("shows chart patterns only", () => {
    expect(shownPatterns(catalog).map((p) => p.id)).toEqual(["doubleBottom"]);
    expect([...shownIds(catalog)]).toEqual(["doubleBottom"]);
    expect(shownPatterns(null)).toEqual([]);
  });

  it("toggles one timeframe for every pattern, keeping 1h · 4h · 1d order", () => {
    expect(toggleTf(DEFAULT_DETECTION, "1h")).toEqual({ tfs: ["1h", "4h", "1d"] });
    expect(toggleTf(DEFAULT_DETECTION, "4h")).toEqual({ tfs: ["1d"] });
    expect(toggleTf({ tfs: [] }, "1d")).toEqual({ tfs: ["1d"] });
  });

  it("parses stored values, dropping unknown timeframes; the old per-pattern form resets", () => {
    expect(parseDetection({ tfs: ["5m", "1d", "1h"] })).toEqual({ tfs: ["1h", "1d"] });
    expect(parseDetection({ tfs: [] })).toEqual({ tfs: [] });
    expect(parseDetection({ patterns: { hammer: ["1h"] }, zones: "4h" })).toEqual(
      DEFAULT_DETECTION,
    );
    expect(parseDetection("junk")).toEqual(DEFAULT_DETECTION);
  });
});
