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

import type {
  OrderBookBbo,
  OrderBookLevel,
  OrderBookSnapshot,
  TradeEvent,
} from "../types/marketData";

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

// ---------------------------------------------------------------------------
// Liquidity churn — per-level quantity changes between two snapshots
// ---------------------------------------------------------------------------

/** One price level's quantity change between two book snapshots. */
export interface DepthDelta {
  price: number;
  side: "bid" | "ask";
  /** Positive = liquidity added at this level; negative = reduced/removed. */
  delta: number;
}

/** Per-side churn between two visible-depth snapshots. */
export interface DepthDiffResult {
  /** Sum of positive per-level deltas on the bid side (base asset units). */
  bidAdded: number;
  /** Sum of negative per-level deltas on the bid side (absolute quantity). */
  bidReduced: number;
  askAdded: number;
  askReduced: number;
  /** Per-level deltas of every changed level. */
  deltas: DepthDelta[];
  /** False when the previous snapshot carried no depth to diff against. */
  hasBaseline: boolean;
}

/**
 * Diff the resting levels of two snapshots by exact price.
 *
 * Data honesty: public aggregate books quote only the sum of resting orders at
 * each price, so "reduced" mixes genuine fills, resting-order edits and
 * cancellations — indistinguishable without an order-ID feed. A level that
 * vanishes entirely counts its full previous quantity as reduced.
 */
export function diffDepthByLevel(
  prev: OrderBookSnapshot,
  next: OrderBookSnapshot,
): DepthDiffResult {
  const result: DepthDiffResult = {
    bidAdded: 0,
    bidReduced: 0,
    askAdded: 0,
    askReduced: 0,
    deltas: [],
    hasBaseline: prev.bids.length > 0 || prev.asks.length > 0,
  };

  for (const side of ["bid", "ask"] as const) {
    if (!result.hasBaseline) break;
    const before = side === "bid" ? prev.bids : prev.asks;
    const after = side === "bid" ? next.bids : next.asks;

    const prevQty = new Map<number, number>();
    for (const l of before) {
      if (Number.isFinite(l.price) && Number.isFinite(l.quantity)) {
        prevQty.set(l.price, l.quantity);
      }
    }
    const seen = new Set<number>();
    for (const l of after) {
      if (!Number.isFinite(l.price) || !Number.isFinite(l.quantity)) continue;
      seen.add(l.price);
      const beforeQty = prevQty.get(l.price);
      if (beforeQty == null) {
        if (l.quantity > 0) {
          result.deltas.push({ price: l.price, side, delta: l.quantity });
          if (side === "bid") result.bidAdded += l.quantity;
          else result.askAdded += l.quantity;
        }
      } else if (l.quantity !== beforeQty) {
        const delta = l.quantity - beforeQty;
        result.deltas.push({ price: l.price, side, delta });
        if (delta > 0) {
          if (side === "bid") result.bidAdded += delta;
          else result.askAdded += delta;
        } else if (side === "bid") {
          result.bidReduced += -delta;
        } else {
          result.askReduced += -delta;
        }
      }
    }
    // Levels that vanished entirely count their full previous quantity as reduced.
    for (const l of before) {
      if (!Number.isFinite(l.price) || !Number.isFinite(l.quantity)) continue;
      if (!seen.has(l.price) && l.quantity > 0) {
        result.deltas.push({ price: l.price, side, delta: -l.quantity });
        if (side === "bid") result.bidReduced += l.quantity;
        else result.askReduced += l.quantity;
      }
    }
  }
  return result;
}

/** Per-price churn Map for the UI ladder (fast row-level lookup). */
export function churnMapByPrice(deltas: DepthDelta[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const d of deltas) {
    map.set(`${d.side}|${d.price}`, d.delta);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Large trade prints (configurable threshold)
// ---------------------------------------------------------------------------

/**
 * Filter a trade list down to prints at/above the configured quantity.
 * These are standalone observations of executed volume — a public feed cannot
 * link a print to a specific account, order or algorithm.
 */
export function findLargePrints(trades: TradeEvent[], minQuantity: number): TradeEvent[] {
  const min = Number.isFinite(minQuantity) ? minQuantity : Infinity;
  return trades.filter((t) => Number.isFinite(t.quantity) && t.quantity >= min);
}
