import { describe, expect, it } from "vite-plus/test";
import type { OrderBlock, Zone } from "../../types/analysis";
import { DEFAULT_OVERLAYS, keyLevels, parseOverlays } from "../overlaySettings";

const zone = (kind: Zone["kind"], low: number, high: number, over: Partial<Zone> = {}): Zone => ({
  kind,
  low,
  high,
  startTime: 0,
  formedTime: 1,
  endTime: null,
  tests: 0,
  held: 0,
  departureAtr: 3,
  ...over,
});

const block = (
  kind: OrderBlock["kind"],
  low: number,
  high: number,
  over: Partial<OrderBlock> = {},
): OrderBlock => ({
  kind,
  low,
  high,
  time: 0,
  formedTime: 1,
  endTime: null,
  mitigatedTime: null,
  broke: 0,
  ...over,
});

describe("keyLevels", () => {
  const price = 100;

  it("keeps the nearest intact strong levels of each kind", () => {
    const zones = [
      zone("demand", 95, 97),
      zone("demand", 90, 92),
      zone("demand", 80, 82),
      zone("supply", 103, 105),
      zone("demand", 98, 99, { departureAtr: 1 }), // too weak
      zone("demand", 96.5, 98, { endTime: 5 }), // broken
    ];
    const out = keyLevels({ zones, orderBlocks: [], fvgs: [] }, price, DEFAULT_OVERLAYS);
    expect(out.zones.map((z) => z.low)).toEqual([95, 90, 103]);
  });

  it("draws only the stronger of two overlapping levels", () => {
    const zones = [
      zone("demand", 95, 97, { departureAtr: 2.5 }),
      zone("demand", 96, 98, { departureAtr: 4 }),
    ];
    const merged = keyLevels({ zones, orderBlocks: [], fvgs: [] }, price, DEFAULT_OVERLAYS);
    expect(merged.zones.map((z) => z.low)).toEqual([96]);
    const all = keyLevels({ zones, orderBlocks: [], fvgs: [] }, price, {
      ...DEFAULT_OVERLAYS,
      mergeOverlaps: false,
    });
    expect(all.zones).toHaveLength(2);
  });

  it("filters to fresh levels and adds recently broken ones on request", () => {
    const orderBlocks = [
      block("bullish", 95, 96, { mitigatedTime: 3 }),
      block("bullish", 90, 91),
      block("bearish", 110, 111, { endTime: 9 }),
    ];
    const fresh = keyLevels({ zones: [], orderBlocks, fvgs: [] }, price, {
      ...DEFAULT_OVERLAYS,
      freshOnly: true,
    });
    expect(fresh.orderBlocks.map((b) => b.low)).toEqual([90]);
    const withBroken = keyLevels({ zones: [], orderBlocks, fvgs: [] }, price, {
      ...DEFAULT_OVERLAYS,
      showBroken: true,
    });
    expect(withBroken.orderBlocks.map((b) => b.low)).toEqual([95, 90, 110]);
  });
});

describe("parseOverlays", () => {
  it("keeps valid choices and falls back for junk", () => {
    expect(
      parseOverlays({ perKind: 5, minZoneAtr: 3, labels: false, patternTags: 0 }),
    ).toMatchObject({
      perKind: 5,
      minZoneAtr: 3,
      labels: false,
      patternTags: 0,
      zones: true,
    });
    expect(parseOverlays({ perKind: 7, minZoneAtr: "x" })).toMatchObject({
      perKind: 2,
      minZoneAtr: 2,
    });
    expect(parseOverlays(null)).toEqual(DEFAULT_OVERLAYS);
  });
});
