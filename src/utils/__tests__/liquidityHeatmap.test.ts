import { describe, expect, it } from "vite-plus/test";
import { farBook, LocalBook, parseOkxFullBook } from "../depthBook";
import {
  bucketForBooks,
  bucketSize,
  columnsToSamples,
  liquidityPools,
  mergeSamples,
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
  it("spreads about 120 buckets across the range the book covers", () => {
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
    expect(bucketForBooks([b])).toBe(1); // $80 / 120 = 0.67 → 1
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

describe("recorded depth history", () => {
  const col = (time: number, bid: number) => ({
    time,
    bucket: 10,
    mid: 100,
    bids: [[9, bid]] as [number, number][],
    asks: [[10, 5]] as [number, number][],
  });

  it("turns recorded minutes into one-minute samples", () => {
    const [s] = columnsToSamples([col(60_000, 900)]);
    expect(s.time).toBe(60_000);
    expect(s.span).toBe(60_000);
    expect(s.bucket).toBe(10);
    expect(s.bids.get(9)).toBe(900);
    expect(s.asks.get(10)).toBe(5);
  });

  it("puts history before live samples without counting a minute twice", () => {
    const history = columnsToSamples([col(0, 1), col(60_000, 2), col(120_000, 3)]);
    const live = columnsToSamples([col(150_000, 9)]).map((s) => ({ ...s, time: 150_000 }));
    const merged = mergeSamples(history, live);
    // The minute from 120 000 ends after live sampling began (150 000): left out.
    expect(merged.map((s) => s.time)).toEqual([0, 60_000, 150_000]);
    expect(mergeSamples([], live)).toBe(live);
    expect(mergeSamples(history, []).length).toBe(3);
  });

  it("feeds the pools across the reload", () => {
    const history = columnsToSamples([col(0, 100), col(60_000, 100)]);
    const pools = liquidityPools(
      history.map((s) => ({
        ...s,
        bids: new Map([
          [1, 1],
          [2, 1],
          [3, 1],
          [4, 1],
          [9, 100],
        ]),
      })),
    );
    expect(pools.find((p) => p.side === "bid")?.restingMs).toBe(60_000);
  });
});

describe("deep book", () => {
  it("adds only the levels beyond the live books", () => {
    const deep = book(
      [
        [99, 9],
        [90, 1],
      ],
      [
        [101, 9],
        [150, 3],
      ],
    );
    const near = book(
      [
        [99, 1],
        [95, 1],
      ],
      [
        [101, 1],
        [110, 1],
      ],
    );
    const far = farBook(deep, [near]);
    expect([...far.bids]).toEqual([[90, 1]]);
    expect([...far.asks]).toEqual([[150, 3]]);
  });

  it("parses OKX's full book in base units", () => {
    const b = parseOkxFullBook({ data: [{ bids: [["100", "200"]], asks: [["101", "50"]] }] }, 0.01);
    expect(b?.bids.get(100)).toBeCloseTo(2);
    expect(b?.asks.get(101)).toBeCloseTo(0.5);
    expect(parseOkxFullBook({ data: [] }, 0.01)).toBeNull();
  });
});
