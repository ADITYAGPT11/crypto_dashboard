import { describe, expect, it } from "vite-plus/test";
import { groupDetections, groupId, type Detection } from "../patternGroups";

const d = (
  pattern: string,
  direction: "long" | "short",
  tf: Detection["tf"],
  closeTime: number,
): Detection => ({ pattern, direction, tf, closeTime });

describe("groupDetections", () => {
  it("makes one group per pattern and direction, newest first", () => {
    const groups = groupDetections(
      [
        d("double_bottom", "long", "4h", 100),
        d("rising_wedge", "short", "1h", 300),
        d("double_bottom", "long", "1h", 200),
        d("double_bottom", "short", "1d", 50),
      ],
      ["1h", "4h", "1d"],
    );
    expect(groups.map((g) => g.id)).toEqual([
      "rising_wedge|short",
      "double_bottom|long",
      "double_bottom|short",
    ]);
    const db = groups[1];
    expect(db.latest.closeTime).toBe(200);
    expect(db.latest.tf).toBe("1h");
    expect(db.count).toBe(2);
  });

  it("lists each timeframe once, in the given order", () => {
    const [g] = groupDetections(
      [
        d("bull_flag", "long", "1d", 1),
        d("bull_flag", "long", "1h", 2),
        d("bull_flag", "long", "1d", 3),
      ],
      ["1h", "4h", "1d"],
    );
    expect(g.tfs).toEqual(["1h", "1d"]);
  });

  it("is empty for no detections and keys groups by pattern and direction", () => {
    expect(groupDetections([], ["1h"])).toEqual([]);
    expect(groupId({ pattern: "x", direction: "long" })).toBe("x|long");
  });
});
