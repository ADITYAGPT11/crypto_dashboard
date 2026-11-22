import { describe, expect, it } from "vite-plus/test";
import { monthDay, shortDate } from "../format";

describe("dates", () => {
  const t = Date.UTC(2026, 10, 22, 14, 15);
  it("formats compact UTC dates", () => {
    expect(monthDay(t)).toBe("Nov 22");
    expect(monthDay(t, true)).toBe("Nov 22 14:15");
    expect(monthDay(Date.UTC(2026, 0, 3, 4, 5), true)).toBe("Jan 3 04:05");
    expect(shortDate(t)).toBe("2026-11-22");
  });
});
