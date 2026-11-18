import { describe, expect, it } from "vite-plus/test";
import type { IngredientOut, MoveSummaryOut } from "../../api/schema";
import { findings, rowsFor } from "../research";

const m = (meanAtr: number, costAtr = 0.07): MoveSummaryOut => ({
  n: 500,
  meanAtr,
  low: meanAtr - 0.01,
  high: meanAtr + 0.01,
  lowAdj: meanAtr - 0.02,
  highAdj: meanAtr + 0.02,
  meanPct: meanAtr,
  hitRate: 0.5,
  costAtr,
  netAtr: meanAtr - costAtr,
  netLowAdj: meanAtr - costAtr - 0.02,
});

const ing = (
  id: string,
  mean: number,
  verdict: IngredientOut["results"][number]["verdict"],
): IngredientOut => ({
  id,
  label: id,
  kind: "event",
  rule: "",
  results: [
    {
      horizon: 6,
      verdict,
      all: m(mean),
      orig10: m(mean),
      new15: m(mean),
      older: m(mean),
      newer: m(mean),
    },
  ],
});

describe("research display", () => {
  it("orders by effect and keeps only the horizon asked for", () => {
    const rows = rowsFor(
      [ing("a", 0.01, "none"), ing("b", 0.05, "edgeBeforeCosts"), ing("c", -0.2, "reversed")],
      6,
    );
    expect(rows.map((r) => r.ingredient.id)).toEqual(["b", "a", "c"]);
    expect(rowsFor([ing("a", 0.01, "none")], 24)).toEqual([]);
  });

  it("writes findings only for consistent effects, comparing them with costs", () => {
    const f = findings([
      ing("delta", 0.049, "edgeBeforeCosts"),
      ing("noise", 0.01, "none"),
      ing("fade", -0.2, "reversed"),
    ]);
    expect(f).toHaveLength(2);
    expect(f[0]).toContain("+0.049 ATR");
    expect(f[0]).toContain("smaller than a round trip's cost");
    expect(f[1]).toContain("OTHER way");
    expect(f[1]).toContain("2.9× a round trip's cost");
  });
});
