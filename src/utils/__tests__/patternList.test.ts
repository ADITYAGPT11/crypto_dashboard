import { describe, expect, it } from "vite-plus/test";
import { LIST_SIZE, latestPatterns, MIN_CHECKS } from "../patternList";

const d = (closeTime: number, score: number) => ({ closeTime, occ: { score } });

describe("latestPatterns", () => {
  it("keeps detections with at least 3 of 6 checks, newest first", () => {
    const out = latestPatterns([d(1, 3), d(3, 2), d(2, 6), d(4, 4)]);
    expect(out.map((f) => f.closeTime)).toEqual([4, 2, 1]);
    expect(MIN_CHECKS).toBe(3);
  });

  it("lists at most 10", () => {
    const many = Array.from({ length: 25 }, (_, i) => d(i, 5));
    const out = latestPatterns(many);
    expect(out).toHaveLength(LIST_SIZE);
    expect(out[0].closeTime).toBe(24);
    expect(out[9].closeTime).toBe(15);
  });

  it("is empty when nothing meets the minimum", () => {
    expect(latestPatterns([d(1, 0), d(2, 2)])).toEqual([]);
  });
});
