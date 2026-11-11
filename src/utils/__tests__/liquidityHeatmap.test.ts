import { describe, expect, it } from "vite-plus/test";
import { LocalBook } from "../depthBook";
import {
  bucketForBooks,
  bucketSize,
  heatmapFrame,
  liquidityPools,
  sampleBooks,
  stableBucket,
} from "../liquidityHeatmap";

function book(bids: [number, number][], asks: [number, number][]) {
  const b = new LocalBook();
  b.apply("bid", bids);
  b.apply("ask", asks);
  return b;
}

describe("bucketSize", () => {
  it("picks a round size near 5 bps of price", () => {
    expect(bucketSize(74_000)).toBe(50);
    expect(bucketSize(2_500)).toBe(2);
    expect(bucketSize(0.25)).toBeCloseTo(0.0002, 10); // 5 bps = 0.000125 → next round step
  });
});

describe("bucketForBooks", () => {
  it("spreads about 50 buckets across the range the book covers", () => {
    // OKX sends 400 levels: for BTC at 0.1 tick that is only ~$40 each side.
    const b = book(
      [
        [74_000, 1],
        [73_960, 1],
      ],
      [
        [74_000.1, 1],
        [74_040, 1],
      ],
    );
    expect(bucketForBooks([b])).toBe(2); // $80 / 50 = 1.6 → 2
    expect(bucketForBooks([new LocalBook()])).toBeNull();
  });

  it("keeps the bucket until the book's reach changes more than twofold", () => {
    expect(stableBucket(2, 2.5)).toBe(2);
    expect(stableBucket(2, 5)).toBe(5);
    expect(stableBucket(null, 1)).toBe(1);
    expect(stableBucket(2, null)).toBe(2);
  });
});

describe("sampleBooks", () => {
  it("adds books together in notional per price bucket", () => {
    const a = book(
      [
        [100, 1],
        [99.5, 2],
      ],
      [[101, 1]],
    );
    const b = book([[100.2, 1]], [[101.4, 3]]);
    const s = sampleBooks([a, b], 0, 1)!;
    expect(s.bids.get(100)).toBeCloseTo(100 * 1 + 100.2 * 1);
    expect(s.bids.get(99)).toBeCloseTo(99.5 * 2);
    expect(s.asks.get(101)).toBeCloseTo(101 + 101.4 * 3);
    expect(sampleBooks([], 0)).toBeNull();
  });
});

describe("heatmapFrame", () => {
  it("averages each bucket over the samples inside a bar", () => {
    const wall = book([[100, 10]], [[101, 1]]);
    const gone = book([[100, 0]], [[101, 1]]);
    const samples = [
      sampleBooks([wall], 0, 1)!,
      sampleBooks([gone], 30_000, 1)!,
      sampleBooks([wall], 60_000, 1)!,
    ];
    const f = heatmapFrame(samples, 60_000)!;
    expect(f.columns.map((c) => c.time)).toEqual([0, 60_000]);
    const firstBar = f.columns[0].cells.find((c) => c.side === "bid" && c.price === 100)!;
    expect(firstBar.notional).toBeCloseTo((100 * 10) / 2); // present in one of two samples
  });
});

describe("liquidityPools", () => {
  it("lists the largest buckets per side, flags walls and measures how long they rested", () => {
    const levels = (wall: number): [number, number][] => [
      [100, wall],
      [99, 1],
      [98, 1],
      [97, 1],
      [96, 1],
      [95, 1],
    ];
    const asks: [number, number][] = [
      [101, 1],
      [102, 1],
      [103, 1],
      [104, 1],
      [105, 1],
    ];
    const samples = [0, 2_000, 4_000].map((t, i) =>
      sampleBooks([book(levels(i === 0 ? 1 : 20), asks)], t, 1)!,
    );
    const pools = liquidityPools(samples, { perSide: 2 });
    expect(pools).toHaveLength(4);
    expect(pools[0]).toMatchObject({
      side: "bid",
      low: 100,
      high: 101,
      restingMs: 2_000,
      wall: true,
    });
    expect(pools[0].multiple).toBeGreaterThan(10);
    expect(pools.filter((p) => p.wall)).toHaveLength(1);
  });
});
