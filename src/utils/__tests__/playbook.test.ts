import { describe, expect, it } from "vite-plus/test";
import type {
  PlaybookStatsOut,
  PlaybookTradeOut,
  PlaybookTriggerOut,
  RSummaryOut,
} from "../../api/schema";
import {
  bestVariant,
  DEFAULT_VARIANT,
  findVariant,
  signedR,
  stageText,
  tradeText,
  variantLabel,
} from "../playbook";

const summary = (meanR: number, n: number): RSummaryOut => ({
  n,
  wins: Math.round(n / 2),
  winRate: 0.5,
  ciLow: 0.4,
  ciHigh: 0.6,
  meanR,
  meanRLow: meanR - 0.1,
  meanRHigh: meanR + 0.1,
  meanGrossR: meanR + 0.05,
  avgWinR: 1.5,
  avgLossR: -1,
  profitFactor: 1.2,
  medianBars: 20,
  baselineN: n,
  baselineMeanR: 0,
  edgeVsRandom: meanR,
  edgeVsRandomLow: meanR - 0.1,
  edgeVsRandomHigh: meanR + 0.1,
  verdict: "noEdge",
});

const stats = (rows: [string, string, number, number][]): PlaybookStatsOut =>
  ({
    ruleset: "r3",
    htf: "4h",
    ltf: "15m",
    run: null,
    split: null,
    params: {} as PlaybookStatsOut["params"],
    variants: rows.map(([entry, exit, r, n]) => ({
      entry,
      exit,
      all: summary(r, n),
      inSample: null,
      outOfSample: null,
    })),
  }) as PlaybookStatsOut;

describe("playbook display", () => {
  it("picks the best measured variant with enough trades, else the default plan", () => {
    expect(bestVariant(null)).toBe(DEFAULT_VARIANT);
    const s = stats([
      ["market", "target", 0.5, 10], // best but too few trades
      ["fib", "trail", 0.2, 80],
      ["fvg", "managed", -0.1, 90],
    ]);
    expect(bestVariant(s)).toBe("fib|trail");
    expect(findVariant(s, "fvg|managed")?.all?.n).toBe(90);
    expect(findVariant(s, "market|managed")).toBeNull();
  });

  it("writes R with a sign and labels variants", () => {
    expect(signedR(0.234)).toBe("+0.23R");
    expect(signedR(-1)).toBe("−1.00R");
    expect(signedR(0.001)).toBe("0.00R");
    expect(variantLabel("fib", "managed")).toBe(
      "Limit at 0.618 Fib · Breakeven 1R, half at 2R, trail",
    );
  });

  it("describes stages and trades in plain words", () => {
    const t = { stage: "expired", windowEnd: 0 } as PlaybookTriggerOut;
    expect(stageText(t, "15m")).toContain("No 15m change of character");
    expect(stageText({ ...t, stage: "invalidated" }, "15m")).toContain("beyond the setup's stop");
    const tr = {
      status: "closed",
      exitPrice: 105,
      reason: "trail",
      rNet: 1.234,
      entry: 100,
      stop: 98,
    } as PlaybookTradeOut;
    expect(tradeText(tr)).toBe("Closed at 105.00 (trailing stop): +1.23R after costs");
    expect(tradeText({ ...tr, status: "skipped", note: "stop too wide" })).toBe(
      "Skipped: stop too wide",
    );
    expect(tradeText({ ...tr, status: "pending" })).toContain("waiting for the pullback");
  });
});
