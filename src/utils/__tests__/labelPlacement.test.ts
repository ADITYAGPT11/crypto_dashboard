import { describe, expect, it } from "vite-plus/test";
import { freeOffset, overlaps } from "../labelPlacement";

const r = (x: number, y: number, w = 60, h = 16) => ({ x, y, w, h });
const screen = { top: 0, bottom: 500 };

describe("label placement", () => {
  it("detects overlap with a small gap", () => {
    expect(overlaps(r(0, 0), r(30, 10))).toBe(true);
    expect(overlaps(r(0, 0), r(0, 30))).toBe(false);
    expect(overlaps(r(0, 0), r(61, 0))).toBe(true); // within the 2 px gap
  });

  it("keeps a free label where it is", () => {
    expect(freeOffset(r(100, 100), [r(300, 100)], screen)).toBe(0);
  });

  it("nudges away from the pattern first, then the other way", () => {
    expect(freeOffset(r(100, 100), [r(100, 100)], screen)).toBe(-18);
    expect(freeOffset(r(100, 100), [r(100, 100)], screen, 1)).toBe(18);
    expect(freeOffset(r(100, 100), [r(100, 100), r(100, 82)], screen)).toBe(18);
  });

  it("stays on screen and gives up when nothing fits", () => {
    expect(freeOffset(r(100, 5), [r(100, 5)], screen)).toBe(18);
    const crowd = [-36, -18, 0, 18, 36].map((dy) => r(100, 100 + dy));
    expect(freeOffset(r(100, 100), crowd, screen)).toBeNull();
  });
});
