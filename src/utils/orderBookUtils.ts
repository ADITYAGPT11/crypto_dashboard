/**
 * Pure order-book analytics over normalized OrderBookSnapshot data.
 *
 * These are pure functions with no exchange types, no UI types — just numbers
 * and arrays. They are unit-testable and reusable across adapters/sources.
 *
 * Data honesty (projectNotes.txt guardrail):
 * - Public WebSocket feeds show visible resting orders only.
 * - They cannot identify the owner of an order.
 * - Large quantities can be spoofed or cancelled before execution.
 * - Every metric computed here is an observation of visible liquidity, not an
 *   estimate of true executable depth or institutional intent.
 */

import type { OrderBookBbo, OrderBookLevel, OrderBookSnapshot } from "../types/marketData";

// ---------------------------------------------------------------------------
// Top-of-book metrics
// ---------------------------------------------------------------------------

/** Best bid, best ask and mid from a BBO. Returns null when either side missing. */
export function bboMetrics(bbo: OrderBookBbo): {
  spread: number; // absolute (ask - bid)
  spreadPercent: number; // (ask - bid) / mid * 100
  mid: number;
  isComplete: boolean;
} {
  const { bidPrice, askPrice } = bbo;
  if (bidPrice <= 0 || askPrice <= 0 || askPrice <= bidPrice) {
    return { spread: NaN, spreadPercent: NaN, mid: NaN, isComplete: false };
  }
  const mid = (bidPrice + askPrice) / 2;
  const spread = askPrice - bidPrice;
  const spreadPercent = (spread / mid) * 100;
  return { spread, spreadPercent, mid, isComplete: true };
}

/** Best bid, best ask and mid from a snapshot. Returns null when either side missing. */
export function snapshotBboMetrics(snap: OrderBookSnapshot): {
  spread: number;
  spreadPercent: number;
  mid: number;
  isComplete: boolean;
} {
  if (snap.bestBid == null || snap.bestAsk == null || snap.bestAsk <= snap.bestBid) {
    return { spread: NaN, spreadPercent: NaN, mid: snap.midPrice ?? NaN, isComplete: false };
  }
  const mid = (snap.bestBid + snap.bestAsk) / 2;
  const spread = snap.bestAsk - snap.bestBid;
  const spreadPercent = (spread / mid) * 100;
  return { spread, spreadPercent, mid, isComplete: true };
}

// ---------------------------------------------------------------------------
// Depth by distance from mid
// ---------------------------------------------------------------------------

/** Maximum price-distance (in ticks/percent) to include when aggregating depth. */
export interface DepthBandConfig {
  /** Price-distance cutoff, in percent away from mid. e.g. 1 = ±1% from mid. */
  maxDistancePercent: number;
  /** Smallest quantity to count as a non-empty level (filters dust). */
  minQuantity: number;
}

/** Default depth band: ±1% from mid, ignore levels below 0.001 base asset. */
export const DEFAULT_DEPTH_BAND: DepthBandConfig = {
  maxDistancePercent: 1,
  minQuantity: 0.001,
};

/**
 * Aggregate visible depth on each side of the book within a price band around
 * the mid price, and compute cumulative depth at each level.
 *
 * Returns the band config actually used (so callers can surface it in the UI).
 */
export function aggregateDepthByDistance(
  snap: OrderBookSnapshot,
  config?: Partial<DepthBandConfig>,
): {
  config: DepthBandConfig;
  bidDepth: Array<{ price: number; quantity: number; cumulative: number }>;
  askDepth: Array<{ price: number; quantity: number; cumulative: number }>;
  totalBidQuantity: number;
  totalAskQuantity: number;
  isComplete: boolean;
} {
  const cfg: DepthBandConfig = { ...DEFAULT_DEPTH_BAND, ...config };
  const _mid = snap.midPrice;
  if (_mid == null || !Number.isFinite(_mid) || _mid <= 0) {
    return {
      config: cfg,
      bidDepth: [],
      askDepth: [],
      totalBidQuantity: 0,
      totalAskQuantity: 0,
      isComplete: false,
    };
  }

  if (_mid == null) {
    return {
      config: cfg,
      bidDepth: [],
      askDepth: [],
      totalBidQuantity: 0,
      totalAskQuantity: 0,
      isComplete: false,
    };
  }
  const maxDistance = _mid * (cfg.maxDistancePercent / 100);
  const lo = _mid - maxDistance;
  const hi = _mid + maxDistance;

  const inBand = (level: OrderBookLevel) =>
    Number.isFinite(level.price) &&
    level.price > 0 &&
    level.quantity >= cfg.minQuantity &&
    level.price >= lo &&
    level.price <= hi;

  const bids = snap.bids.filter(inBand).sort((a, b) => b.price - a.price); // highest first
  const asks = snap.asks.filter(inBand).sort((a, b) => a.price - b.price); // lowest first

  let bidCum = 0;
  const bidDepth = bids.map((b) => {
    bidCum += b.quantity;
    return { price: b.price, quantity: b.quantity, cumulative: bidCum };
  });

  let askCum = 0;
  const askDepth = asks.map((a) => {
    askCum += a.quantity;
    return { price: a.price, quantity: a.quantity, cumulative: askCum };
  });

  return {
    config: cfg,
    bidDepth,
    askDepth,
    totalBidQuantity: bidCum,
    totalAskQuantity: askCum,
    isComplete: true,
  };
}

// ---------------------------------------------------------------------------
// Order-book imbalance
// ---------------------------------------------------------------------------

/**
 * Order-book imbalance across the top of book or a depth band.
 *
 * Convention: positive = bid side heavier, negative = ask side heavier.
 *   imbalance = (bidQty - askQty) / (bidQty + askQty)   ∈ (-1, 1)
 *
 * When total visible quantity is 0 the imbalance is 0 (neutral).
 */
export function orderBookImbalance(bidQuantity: number, askQuantity: number): number {
  const total = bidQuantity + askQuantity;
  if (total <= 0) return 0;
  return (bidQuantity - askQuantity) / total;
}

/**
 * Imbalance computed over the top-N levels on each side of the book.
 * `n` = number of price levels to include from each side.
 */
export function imbalanceTopN(
  bids: OrderBookLevel[],
  asks: OrderBookLevel[],
  n: number,
): { imbalance: number; bidQuantity: number; askQuantity: number; levelsUsed: number } {
  const topBids = bids.slice(0, Math.max(0, n));
  const topAsks = asks.slice(0, Math.max(0, n));
  const bidQty = topBids.reduce((s, l) => s + (Number.isFinite(l.quantity) ? l.quantity : 0), 0);
  const askQty = topAsks.reduce((s, l) => s + (Number.isFinite(l.quantity) ? l.quantity : 0), 0);
  return {
    imbalance: orderBookImbalance(bidQty, askQty),
    bidQuantity: bidQty,
    askQuantity: askQty,
    levelsUsed: topBids.length,
  };
}

// ---------------------------------------------------------------------------
// Large-level detection (configurable threshold)
// ---------------------------------------------------------------------------

/** Config for flagging unusually large visible resting orders. */
export interface LargeLevelConfig {
  /** Minimum visible quantity (in base asset units) to flag as "large". */
  minQuantity: number;
}

/** Default: flag visible levels ≥ 1 whole coin (tune per symbol in practice). */
export const DEFAULT_LARGE_LEVEL_CONFIG: LargeLevelConfig = {
  minQuantity: 1,
};

/**
 * Return visible price levels whose resting quantity meets or exceeds the
 * configured threshold. These are *observed* large orders — not confirmed
 * institutional trades, and not guaranteed executable.
 */
export function findLargeLevels(
  levels: OrderBookLevel[],
  config: LargeLevelConfig,
): OrderBookLevel[] {
  return levels.filter((l) => Number.isFinite(l.quantity) && l.quantity >= config.minQuantity);
}

// ---------------------------------------------------------------------------
// Spread in price ticks (relative to a reference price)
// ---------------------------------------------------------------------------

/** Spread expressed as a fraction of the reference (mid) price. */
export function spreadFraction(bid: number, ask: number, mid?: number): number {
  if (bid <= 0 || ask <= 0 || ask <= bid) return NaN;
  const m = mid ?? (bid + ask) / 2;
  if (m <= 0) return NaN;
  return (ask - bid) / m;
}
