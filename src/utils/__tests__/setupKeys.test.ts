import { describe, expect, it } from "vite-plus/test";
import type { SummaryOut } from "../../api/schema";
import { toStats } from "../setupKeys";

const gross: SummaryOut = {
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
  expectancyR: 0.38,
  medianBars: 6,
  verdict: "noEdge",
};

describe("toStats", () => {
  it("reads expectancy and break-even after costs, keeping gross alongside", () => {
    const s = toStats("doubleBottom", "long", "*", {
      ...gross,
      expectancyNetR: 0.21,
      breakEvenNet: 0.47,
      avgCostR: 0.17,
    });
    expect(s.expectancyR).toBe(0.21);
    expect(s.expectancyGrossR).toBe(0.38);
    expect(s.breakEven).toBe(0.47);
    expect(s.breakEvenGross).toBe(0.4);
    expect(s.avgCostR).toBe(0.17);
  });

  it("falls back to the gross figures for runs before costs were measured", () => {
    const s = toStats("doubleBottom", "long", "*", gross);
    expect(s.expectancyR).toBe(0.38);
    expect(s.breakEven).toBe(0.4);
    expect(s.avgCostR).toBe(0);
    expect(s.trail).toBeNull();
  });
});
