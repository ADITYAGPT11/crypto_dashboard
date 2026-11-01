/**
 * Time-stamped liquidity history recorder (Module 9 groundwork + live heatmap).
 *
 * Records one "frame" of visible order-book levels per second per key:
 *
 *   { t, bids: [{price, qty}], asks: [{price, qty}] }
 *
 * This is exactly the shape a price×time liquidity heatmap needs: x = frame
 * time, y = level price, intensity = qty. A ring buffer bounds memory
 * (MAX_FRAMES seconds of history per key).
 *
 * Data honesty: frames capture *visible* public depth only — spoofed or
 * cancelled levels are indistinguishable from resting liquidity (same caveat
 * as the ladder).
 */
import EventEmitter from "eventemitter3";
import type { ExchangeName, MarketType, OrderBookSnapshot } from "../types/marketData";

/** One book level inside a frame (heatmap cell). */
export interface LiquidityLevel {
  price: number;
  qty: number;
}

/** A point-in-time book capture, heatmap-ready. */
export interface LiquidityFrame {
  /** Epoch ms of the capture. */
  t: number;
  bids: LiquidityLevel[];
  asks: LiquidityLevel[];
}

/** Minimum ms between frames per key (downsamples the 100ms depth stream). */
export const LIQUIDITY_RECORD_INTERVAL_MS = 1_000;

/** Ring size per key (~10 minutes of 1s frames). */
export const MAX_LIQUIDITY_FRAMES = 600;

export class LiquidityHistoryService extends EventEmitter {
  private static instance: LiquidityHistoryService | null = null;

  /** key → frames (ascending by t). */
  private frames = new Map<string, LiquidityFrame[]>();
  /** key → epoch ms of the last stored frame (cadence gate). */
  private lastRecordedAt = new Map<string, number>();

  private constructor() {
    super();
  }

  static getInstance(): LiquidityHistoryService {
    if (!LiquidityHistoryService.instance) {
      LiquidityHistoryService.instance = new LiquidityHistoryService();
    }
    return LiquidityHistoryService.instance;
  }

  static resetInstance() {
    LiquidityHistoryService.instance = null;
  }

  makeKey(exchange: ExchangeName, type: MarketType, symbol: string): string {
    return `${exchange}|${type}|${symbol}`;
  }

  /**
   * Record a snapshot (called on every order-book publish; cadence-gated to
   * one frame per LIQUIDITY_RECORD_INTERVAL_MS per key).
   * Returns true when a frame was stored.
   */
  record(snap: OrderBookSnapshot): boolean {
    const key = this.makeKey(snap.exchange, snap.type, snap.symbol);
    const t = snap.updatedAt;
    if (!Number.isFinite(t)) return false;

    const last = this.lastRecordedAt.get(key);
    if (last != null && t - last < LIQUIDITY_RECORD_INTERVAL_MS) return false;

    const frame: LiquidityFrame = {
      t,
      bids: snap.bids.map((l) => ({ price: l.price, qty: l.quantity })),
      asks: snap.asks.map((l) => ({ price: l.price, qty: l.quantity })),
    };

    let list = this.frames.get(key);
    if (!list) {
      list = [];
      this.frames.set(key, list);
    }
    list.push(frame);
    if (list.length > MAX_LIQUIDITY_FRAMES) {
      list.splice(0, list.length - MAX_LIQUIDITY_FRAMES);
    }
    this.lastRecordedAt.set(key, t);
    this.emit("frames", key);
    return true;
  }

  /** Ascending frames for a key (empty when nothing recorded yet). */
  getFrames(exchange: ExchangeName, type: MarketType, symbol: string): LiquidityFrame[] {
    return this.frames.get(this.makeKey(exchange, type, symbol)) ?? [];
  }

  /** Drop a removed symbol's history. */
  removeSymbol(exchange: ExchangeName, type: MarketType, symbol: string): void {
    const key = this.makeKey(exchange, type, symbol);
    this.frames.delete(key);
    this.lastRecordedAt.delete(key);
  }
}
