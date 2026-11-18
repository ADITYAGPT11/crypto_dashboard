import { describe, expect, it } from "vite-plus/test";
import type { SummaryOut } from "../../api/schema";
import { compare, contextLabel, contextsOf, flowText, isFlowContext } from "../flowContext";

const summary = (n: number, winRate: number, ciLow: number, ciHigh: number): SummaryOut => ({
  n,
  wins: Math.round(n * winRate),
  losses: n - Math.round(n * winRate),
  expired: 0,
  open: 0,
  winRate,
  ciLow,
  ciHigh,
  breakEven: 0.4,
  avgWinPct: 2,
  avgLossPct: -1,
  expectancyR: 0.1,
  medianBars: 5,
  verdict: "noEdge",
});

describe("flow context", () => {
  it("lists the buckets an occurrence falls in", () => {
    expect(contextsOf({ deltaRatio: 0.04, flow: "confirms", cvdDivergence: true })).toEqual([
      "delta:confirms",
      "cvdDiv:yes",
    ]);
    expect(contextsOf({ deltaRatio: -0.1, flow: "against", cvdDivergence: null })).toEqual([
      "delta:against",
    ]);
    expect(contextsOf({ deltaRatio: null, flow: null, cvdDivergence: null })).toEqual([]);
  });

  it("describes delta in plain words", () => {
    expect(flowText({ deltaRatio: 0.031, flow: "confirms", cvdDivergence: false })).toBe(
      "Delta over 3 candles +3.1% of volume (with the setup)",
    );
    expect(flowText({ deltaRatio: -0.05, flow: "against", cvdDivergence: false })).toContain(
      "−5.0%",
    );
    expect(flowText({ deltaRatio: null, flow: null, cvdDivergence: null })).toContain(
      "not measurable",
    );
  });

  it("calls a bucket different only when its whole range is on one side", () => {
    const all = 0.5;
    expect(compare(summary(100, 0.65, 0.55, 0.74), all, 30)).toBe("better");
    expect(compare(summary(100, 0.35, 0.26, 0.45), all, 30)).toBe("worse");
    expect(compare(summary(100, 0.55, 0.45, 0.64), all, 30)).toBe("unclear");
    expect(compare(summary(20, 0.9, 0.7, 0.97), all, 30)).toBe("tooFew");
    expect(compare(summary(100, 0.6, 0.5, 0.7), null, 30)).toBe("tooFew");
  });

  it("labels and validates ids", () => {
    expect(contextLabel("cvdDiv:yes")).toBe("CVD divergence");
    expect(contextLabel("other")).toBe("other");
    expect(isFlowContext("delta:neutral")).toBe(true);
    expect(isFlowContext("delta:maybe")).toBe(false);
  });
});
