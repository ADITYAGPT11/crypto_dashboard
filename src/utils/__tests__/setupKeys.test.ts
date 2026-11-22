import { describe, expect, it } from "vite-plus/test";
import { locationLabel, normalizeSetupKey, parseSetupKey, setupKey } from "../setupKeys";

describe("setup keys", () => {
  it("round-trips and rejects junk", () => {
    expect(parseSetupKey(setupKey("doubleTop", "short", "confluence"))).toEqual({
      pattern: "doubleTop",
      direction: "short",
      location: "confluence",
    });
    expect(parseSetupKey("doubleTop|sideways|zone")).toBeNull();
    expect(parseSetupKey("doubleTop|short|nowhere")).toBeNull();
    expect(parseSetupKey("a b|long|zone")).toBeNull();
    expect(parseSetupKey("")).toBeNull();
  });

  it("upgrades keys stored before directions existed", () => {
    expect(normalizeSetupKey("doubleBottom|demandZone")).toBe("doubleBottom|long|zone");
    expect(normalizeSetupKey("hammer|openSpace")).toBe("hammer|long|openSpace");
    expect(normalizeSetupKey("tweezersBottom|openSpace")).toBeNull(); // retired pattern
  });

  it("names locations by direction", () => {
    expect(locationLabel("zone", "long")).toBe("in demand zone");
    expect(locationLabel("zone", "short")).toBe("in supply zone");
    expect(locationLabel("orderBlock", "short")).toBe("at bearish order block");
  });
});
