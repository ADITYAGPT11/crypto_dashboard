import { describe, expect, it } from "vite-plus/test";
import { confidenceLabel } from "../confidence";

describe("confidenceLabel", () => {
  it("rounds the win rate and shows the wider side of its range", () => {
    expect(
      confidenceLabel({ winRate: 0.412, ciLow: 0.345, ciHigh: 0.48, n: 210, basis: "score" }),
    ).toEqual({ value: "41%", spread: "±7" });
  });

  it("is empty until the service has a record", () => {
    expect(confidenceLabel(null)).toBeNull();
    expect(confidenceLabel(undefined)).toBeNull();
  });

  it("never shows ±0", () => {
    expect(
      confidenceLabel({ winRate: 0.3, ciLow: 0.299, ciHigh: 0.301, n: 9000, basis: "pattern" })
        ?.spread,
    ).toBe("±1");
  });
});
