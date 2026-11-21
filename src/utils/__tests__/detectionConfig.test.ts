import { describe, expect, it } from "vite-plus/test";
import type { CatalogOut } from "../../api/schema";
import {
  DEFAULT_DETECTION,
  parseDetection,
  patternOptions,
  pickedKeys,
  setPicks,
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
    {
      id: "symmetricalTriangle",
      label: "Symmetrical triangle",
      kind: "chart",
      bias: "either",
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
  it("lists every pattern per direction; either-way patterns twice", () => {
    expect(patternOptions(catalog).map((o) => [o.key, o.label])).toEqual([
      ["doubleBottom|long", "Double bottom"],
      ["symmetricalTriangle|long", "Symmetrical triangle (up)"],
      ["symmetricalTriangle|short", "Symmetrical triangle (down)"],
      ["hammer|long", "Hammer"],
    ]);
    expect(patternOptions(null)).toEqual([]);
  });

  it("shows chart patterns and hides candlesticks until picked", () => {
    expect([...pickedKeys(DEFAULT_DETECTION, catalog)]).toEqual([
      "doubleBottom|long",
      "symmetricalTriangle|long",
      "symmetricalTriangle|short",
    ]);
    const cfg = setPicks(DEFAULT_DETECTION, ["hammer|long", "symmetricalTriangle|short"], true);
    const off = setPicks(cfg, ["symmetricalTriangle|short"], false);
    expect([...pickedKeys(off, catalog)]).toEqual([
      "doubleBottom|long",
      "symmetricalTriangle|long",
      "hammer|long",
    ]);
    expect(pickedKeys(off, null).size).toBe(0);
  });

  it("toggles one timeframe for every pattern, keeping 1h · 4h · 1d order", () => {
    expect(toggleTf(DEFAULT_DETECTION, "1h").tfs).toEqual(["1h", "4h", "1d"]);
    expect(toggleTf(DEFAULT_DETECTION, "4h").tfs).toEqual(["1d"]);
  });

  it("parses stored values, dropping unknown timeframes and junk picks", () => {
    expect(
      parseDetection({
        tfs: ["5m", "1d", "1h"],
        picks: { "hammer|long": true, "bad key": true, "doubleTop|up": false, "x|long": 1 },
      }),
    ).toEqual({ tfs: ["1h", "1d"], picks: { "hammer|long": true } });
    expect(parseDetection({ tfs: ["4h"] })).toEqual({ tfs: ["4h"], picks: {} });
    expect(parseDetection({ patterns: { hammer: ["1h"] }, zones: "4h" })).toEqual(
      DEFAULT_DETECTION,
    );
    expect(parseDetection("junk")).toEqual(DEFAULT_DETECTION);
  });
});
