/**
 * Unit tests for src/utils/orderBookUtils.ts
 *
 * Pure functions over normalized OrderBookSnapshot / OrderBookBbo data.
 * No exchange types leak into these tests — only numbers and arrays.
 */
import { describe, expect, it } from "vite-plus/test";
import {
  bboMetrics,
  snapshotBboMetrics,
  aggregateDepthByDistance,
  DEFAULT_DEPTH_BAND,
  orderBookImbalance,
  imbalanceTopN,
  findLargeLevels,
  DEFAULT_LARGE_LEVEL_CONFIG,
  spreadFraction,
} from "../orderBookUtils";
import type { OrderBookLevel } from "../../types/marketData";

// ---------------------------------------------------------------------------
// Helpers to build test snapshots / BBOs
// ---------------------------------------------------------------------------

function makeBbo(
  over: {
    bidPrice?: number;
    bidQuantity?: number;
    askPrice?: number;
    askQuantity?: number;
  } = {},
): {
  exchange: "BINANCE";
  symbol: "BTC-USDT";
  type: "SPOT";
  bidPrice: number;
  bidQuantity: number;
  askPrice: number;
  askQuantity: number;
  timeStamp: number;
} {
  return {
    exchange: "BINANCE",
    symbol: "BTC-USDT",
    type: "SPOT",
    bidPrice: 64321,
    bidQuantity: 0.5,
    askPrice: 64322,
    askQuantity: 0.3,
    timeStamp: 1700000000000,
    ...over,
  };
}

function level(price: number, qty: number): OrderBookLevel {
  return { price, quantity: qty, updatedAt: 1700000000000 };
}

function makeSnap(
  over: {
    bestBid?: number | null;
    bestBidQty?: number | null;
    bestAsk?: number | null;
    bestAskQty?: number | null;
    midPrice?: number | null;
    bids?: OrderBookLevel[];
    asks?: OrderBookLevel[];
  } = {},
): {
  exchange: "BINANCE";
  symbol: "BTC-USDT";
  type: "SPOT";
  bestBid: number | null;
  bestBidQty: number | null;
  bestAsk: number | null;
  bestAskQty: number | null;
  midPrice: number | null;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  updatedAt: number;
} {
  return {
    exchange: "BINANCE",
    symbol: "BTC-USDT",
    type: "SPOT",
    bestBid: 64321,
    bestBidQty: 0.5,
    bestAsk: 64322,
    bestAskQty: 0.3,
    midPrice: 64321.5,
    bids: [],
    asks: [],
    updatedAt: 1700000000000,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// bboMetrics
// ---------------------------------------------------------------------------

describe("bboMetrics", () => {
  it("computes spread, spread percent and mid from a complete BBO", () => {
    const r = bboMetrics(makeBbo({ bidPrice: 100, askPrice: 101 }));

    expect(r.isComplete).to.equal(true);
    expect(r.mid).to.equal(100.5);
    expect(r.spread).to.equal(1);
    expect(r.spreadPercent).to.be.closeTo((1 / 100.5) * 100, 1e-9);
  });

  it("returns NaN when bid is zero", () => {
    const r = bboMetrics(makeBbo({ bidPrice: 0, askPrice: 101 }));

    expect(r.isComplete).to.equal(false);
    expect(Number.isNaN(r.spread)).to.equal(true);
  });

  it("returns NaN when ask is zero", () => {
    const r = bboMetrics(makeBbo({ bidPrice: 100, askPrice: 0 }));

    expect(r.isComplete).to.equal(false);
    expect(Number.isNaN(r.spread)).to.equal(true);
  });

  it("returns NaN when ask <= bid (crossed book)", () => {
    const r = bboMetrics(makeBbo({ bidPrice: 101, askPrice: 100 }));

    expect(r.isComplete).to.equal(false);
    expect(Number.isNaN(r.spread)).to.equal(true);
  });

  it("keeps bid/ask qty on the BBO object but only price drives the metrics", () => {
    const r = bboMetrics(makeBbo({ bidPrice: 200, bidQuantity: 5, askPrice: 201, askQuantity: 3 }));
    expect(r.mid).to.equal(200.5);
    expect(r.spread).to.equal(1);
  });
});

// ---------------------------------------------------------------------------
// snapshotBboMetrics
// ---------------------------------------------------------------------------

describe("snapshotBboMetrics", () => {
  it("computes spread/percent/mid from a snapshot with both sides", () => {
    const r = snapshotBboMetrics(makeSnap({ bestBid: 100, bestAsk: 102 }));

    expect(r.isComplete).to.equal(true);
    expect(r.mid).to.equal(101);
    expect(r.spread).to.equal(2);
  });

  it("returns NaN spread when bestBid is null", () => {
    const r = snapshotBboMetrics(makeSnap({ bestBid: null, bestAsk: 102, midPrice: 102 }));

    expect(r.isComplete).to.equal(false);
    expect(r.mid).to.equal(102);
    expect(Number.isNaN(r.spread)).to.equal(true);
  });

  it("returns NaN spread when bestAsk is null", () => {
    const r = snapshotBboMetrics(makeSnap({ bestBid: 100, bestAsk: null, midPrice: 100 }));

    expect(r.isComplete).to.equal(false);
    expect(r.mid).to.equal(100);
    expect(Number.isNaN(r.spread)).to.equal(true);
  });

  it("returns NaN spread when bestAsk <= bestBid", () => {
    const r = snapshotBboMetrics(makeSnap({ bestBid: 102, bestAsk: 101, midPrice: 101.5 }));

    expect(r.isComplete).to.equal(false);
    expect(r.mid).to.equal(101.5);
    expect(Number.isNaN(r.spread)).to.equal(true);
  });
});

// ---------------------------------------------------------------------------
// aggregateDepthByDistance
// ---------------------------------------------------------------------------

describe("aggregateDepthByDistance", () => {
  it("returns empty bands when mid is zero", () => {
    const r = aggregateDepthByDistance(makeSnap({ midPrice: 0, bids: [], asks: [] }));

    expect(r.isComplete).to.equal(false);
    expect(r.bidDepth).to.deep.equal([]);
    expect(r.askDepth).to.deep.equal([]);
  });

  it("returns empty bands when mid is NaN", () => {
    const r = aggregateDepthByDistance(makeSnap({ midPrice: NaN }));

    expect(r.isComplete).to.equal(false);
  });

  it("filters levels outside the ±maxDistancePercent band", () => {
    // mid = 100, ±1% => [99, 101]. Place a bid at 98.9 (out of band) and one at 99.5 (in band).
    const snap = makeSnap({
      midPrice: 100,
      bids: [level(98.9, 1), level(99.5, 2), level(100.5, 3)],
      asks: [level(101.2, 1), level(100.6, 2)],
    });
    const r = aggregateDepthByDistance(snap, {
      maxDistancePercent: 1,
      minQuantity: 0,
    });
    // 98.9 is 1.1% away from 100 → out; 99.5 and 100.5 are in. 101.2 is 1.2% away → out.
    expect(r.bidDepth.map((l) => l.price)).to.have.members([99.5, 100.5]);
    expect(r.askDepth.map((l) => l.price)).to.have.members([100.6]);
  });

  it("excludes levels below minQuantity", () => {
    const snap = makeSnap({
      midPrice: 100,
      bids: [level(99.5, 0.0001), level(99.6, 0.002)],
      asks: [level(100.5, 0.5)],
    });
    const r = aggregateDepthByDistance(snap, {
      maxDistancePercent: 1,
      minQuantity: 0.001,
    });
    expect(r.bidDepth.map((l) => l.price)).to.have.members([99.6]);
    expect(r.askDepth.map((l) => l.price)).to.have.members([100.5]);
  });

  it("returns cumulative quantities that increase along each side", () => {
    const snap = makeSnap({
      midPrice: 100,
      bids: [level(99.9, 1), level(99.8, 2), level(99.7, 3)],
      asks: [level(100.1, 4), level(100.2, 5)],
    });
    const r = aggregateDepthByDistance(snap, {
      maxDistancePercent: 1,
      minQuantity: 0,
    });
    expect(r.bidDepth[0].cumulative).to.equal(1);
    expect(r.bidDepth[1].cumulative).to.equal(3);
    expect(r.bidDepth[2].cumulative).to.equal(6);
    expect(r.askDepth[0].cumulative).to.equal(4);
    expect(r.askDepth[1].cumulative).to.equal(9);
  });

  it("sorts bids descending and asks ascending within the band", () => {
    const snap = makeSnap({
      midPrice: 100,
      bids: [level(99.5, 1), level(99.9, 1), level(99.1, 1)],
      asks: [level(100.5, 1), level(100.1, 1), level(100.9, 1)],
    });
    const r = aggregateDepthByDistance(snap, {
      maxDistancePercent: 1,
      minQuantity: 0,
    });
    const bidPrices = r.bidDepth.map((l) => l.price);
    const askPrices = r.askDepth.map((l) => l.price);
    expect(bidPrices).to.deep.equal([99.9, 99.5, 99.1]);
    expect(askPrices).to.deep.equal([100.1, 100.5, 100.9]);
  });

  it("uses the default band when config is omitted", () => {
    const r = aggregateDepthByDistance(makeSnap());
    expect(r.config).to.deep.equal(DEFAULT_DEPTH_BAND);
  });

  it("returns totals matching the sum of level quantities", () => {
    const snap = makeSnap({
      midPrice: 100,
      bids: [level(99.9, 2), level(99.8, 3)],
      asks: [level(100.1, 5)],
    });
    const r = aggregateDepthByDistance(snap, {
      maxDistancePercent: 1,
      minQuantity: 0,
    });
    expect(r.totalBidQuantity).to.equal(5);
    expect(r.totalAskQuantity).to.equal(5);
  });
});

// ---------------------------------------------------------------------------
// orderBookImbalance
// ---------------------------------------------------------------------------

describe("orderBookImbalance", () => {
  it("returns 0 when bid and ask quantities are equal", () => {
    expect(orderBookImbalance(10, 10)).to.equal(0);
  });

  it("returns +1 when ask side is zero", () => {
    expect(orderBookImbalance(10, 0)).to.equal(1);
  });

  it("returns -1 when bid side is zero", () => {
    expect(orderBookImbalance(0, 10)).to.equal(-1);
  });

  it("returns 0 when both sides are zero", () => {
    expect(orderBookImbalance(0, 0)).to.equal(0);
  });

  it("returns a value in (-1, 1) for mixed quantities", () => {
    // bid 70, ask 30 => (70-30)/(70+30) = 0.4
    expect(orderBookImbalance(70, 30)).to.equal(0.4);
  });
});

// ---------------------------------------------------------------------------
// imbalanceTopN
// ---------------------------------------------------------------------------

describe("imbalanceTopN", () => {
  it("sums the top N levels on each side", () => {
    const bids = [level(99.9, 1), level(99.8, 2), level(99.7, 3)];
    const asks = [level(100.1, 4), level(100.2, 5)];
    const r = imbalanceTopN(bids, asks, 2);
    expect(r.bidQuantity).to.equal(3); // 1 + 2
    expect(r.askQuantity).to.equal(9); // 4 + 5
    expect(r.imbalance).to.equal(orderBookImbalance(3, 9));
  });

  it("caps N to the number of levels on the shorter side", () => {
    const bids = [level(99.9, 1)];
    const asks = [level(100.1, 2), level(100.2, 3), level(100.3, 4)];
    const r = imbalanceTopN(bids, asks, 1);
    // levelsUsed = min(n, bidLen, askLen) = min(1, 1, 3) = 1
    expect(r.levelsUsed).to.equal(1);
    // Only the first level on each side is counted (n is the same for both sides).
    expect(r.bidQuantity).to.equal(1);
    expect(r.askQuantity).to.equal(2);
  });

  it("handles empty sides gracefully", () => {
    const r = imbalanceTopN([], [level(100.1, 5)], 5);
    expect(r.imbalance).to.equal(-1);
    expect(r.bidQuantity).to.equal(0);
    expect(r.askQuantity).to.equal(5);
    expect(r.levelsUsed).to.equal(0);
  });

  it("ignores NaN quantities in levels", () => {
    const bids = [level(99.9, Number.NaN), level(99.8, 2)];
    const asks = [level(100.1, 3)];
    const r = imbalanceTopN(bids, asks, 5);
    expect(r.bidQuantity).to.equal(2);
    expect(r.askQuantity).to.equal(3);
  });
});

// ---------------------------------------------------------------------------
// findLargeLevels
// ---------------------------------------------------------------------------

describe("findLargeLevels", () => {
  it("returns levels whose quantity meets the threshold", () => {
    const levels = [level(100, 0.5), level(101, 2), level(102, 1)];
    const r = findLargeLevels(levels, { minQuantity: 1 });
    expect(r.map((l) => l.price)).to.have.members([101, 102]);
  });

  it("returns an empty array when none meet the threshold", () => {
    const levels = [level(100, 0.1), level(101, 0.5)];
    expect(findLargeLevels(levels, { minQuantity: 1 })).to.deep.equal([]);
  });

  it("excludes levels with NaN quantity", () => {
    const levels = [level(100, Number.NaN), level(101, 2)];
    const result = findLargeLevels(levels, { minQuantity: 1 });
    // level(100, NaN) is not finite → filtered out; level(101, 2) remains.

    expect(result).to.have.length(1);
    expect(result[0].price).to.equal(101);
    expect(result[0].quantity).to.equal(2);
  });

  it("uses the DEFAULT_LARGE_LEVEL_CONFIG (minQuantity = 1)", () => {
    const levels = [level(100, 0.5), level(101, 1.5)];
    const r = findLargeLevels(levels, DEFAULT_LARGE_LEVEL_CONFIG);
    expect(r.map((l) => l.price)).to.have.members([101]);
  });
});

// ---------------------------------------------------------------------------
// spreadFraction
// ---------------------------------------------------------------------------

describe("spreadFraction", () => {
  it("returns (ask - bid) / mid", () => {
    // bid 100, ask 102 => 2/101
    expect(spreadFraction(100, 102)).to.be.closeTo(2 / 101, 1e-9);
  });

  it("uses a provided mid when given", () => {
    expect(spreadFraction(100, 102, 100.5)).to.be.closeTo(2 / 100.5, 1e-9);
  });

  it("returns NaN when ask <= bid", () => {
    expect(Number.isNaN(spreadFraction(102, 100))).to.equal(true);
  });

  it("returns NaN when bid is zero", () => {
    expect(Number.isNaN(spreadFraction(0, 102))).to.equal(true);
  });
});
