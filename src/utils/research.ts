/**
 * The ingredient study as the Research page describes it: horizon and verdict labels, the
 * ordering of the chart, and plain-language findings. Every number comes from the analysis
 * service (`analysis/ingredients.py`, `analysis/ingredient_stats.py`).
 */
import type { IngredientOut, IngredientResultOut } from "../api/schema";

export type Verdict = IngredientResultOut["verdict"];

export const HORIZON_LABEL: Record<number, string> = { 1: "4 hours", 6: "1 day", 24: "4 days" };

export const VERDICT_LABEL: Record<Verdict, string> = {
  edgeAfterCosts: "Edge after costs",
  edgeBeforeCosts: "Edge before costs",
  reversed: "Works reversed",
  inconsistent: "Not consistent",
  none: "No signal",
  tooFew: "Too few signals",
};

export const VERDICT_TONE: Record<Verdict, "up" | "info" | "warn" | "lock" | "down"> = {
  edgeAfterCosts: "up",
  edgeBeforeCosts: "info",
  reversed: "info",
  inconsistent: "warn",
  none: "lock",
  tooFew: "warn",
};

/** Verdicts worth building on (a consistent direction effect, either way). */
export const MEANINGFUL: readonly Verdict[] = ["edgeAfterCosts", "edgeBeforeCosts", "reversed"];

export interface Row {
  ingredient: IngredientOut;
  result: IngredientResultOut;
}

/** One row per ingredient for a horizon, strongest effect (either sign) first. */
export function rowsFor(ingredients: readonly IngredientOut[], horizon: number): Row[] {
  return ingredients
    .flatMap((ingredient) => {
      const result = ingredient.results.find((r) => r.horizon === horizon);
      return result ? [{ ingredient, result }] : [];
    })
    .sort((a, b) => b.result.all.meanAtr - a.result.all.meanAtr);
}

const atr = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(3)} ATR`;

/** Plain-language findings: every ingredient × horizon with a meaningful verdict. */
export function findings(ingredients: readonly IngredientOut[]): string[] {
  const out: string[] = [];
  for (const i of ingredients) {
    for (const r of i.results) {
      if (!MEANINGFUL.includes(r.verdict)) continue;
      const h = HORIZON_LABEL[r.horizon] ?? `${r.horizon} candles`;
      const a = r.all;
      const vsCost =
        Math.abs(a.meanAtr) > a.costAtr
          ? `about ${(Math.abs(a.meanAtr) / a.costAtr).toFixed(1)}× a round trip's cost`
          : `smaller than a round trip's cost (${a.costAtr.toFixed(3)} ATR)`;
      out.push(
        r.verdict === "reversed"
          ? `${i.label}: over ${h}, price tends to go the OTHER way (${atr(a.meanAtr)} per signal), on old and new coins and months; ${vsCost}.`
          : `${i.label}: over ${h}, ${atr(a.meanAtr)} per signal in its direction, on old and new coins and months; ${vsCost}.`,
      );
    }
  }
  return out;
}
