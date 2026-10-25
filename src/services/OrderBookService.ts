/**
 * A keyed store for order-book snapshots + BBO + top-N depth, with per-key
 * listeners (mirrors the LiveMarketDataService pattern).
 *
 * Consumers subscribe with an exchange/type/symbol triple and receive every
 * snapshot / bbo update for that key; unsubscribing is a simple unsubscribe fn.
 */
import type {
  ExchangeName,
  MarketType,
  OrderBookBbo,
  OrderBookSnapshot,
} from "../types/marketData";

type Snapshot = OrderBookSnapshot;
type Bbo = OrderBookBbo;

type Listener = (snap: Snapshot) => void;
type BboListener = (bbo: Bbo) => void;

interface Bucket {
  snapshot: Snapshot;
  bbo: Bbo;
  listeners: Set<Listener>;
  bboListeners: Set<BboListener>;
}

export class OrderBookService {
  private buckets = new Map<string, Bucket>();
  private static instance: OrderBookService;

  static getInstance(): OrderBookService {
    if (!OrderBookService.instance) {
      OrderBookService.instance = new OrderBookService();
    }
    return OrderBookService.instance;
  }

  /** Make a stable notification key for a (exchange, type, symbol) triple. */
  makeKey(exchange: ExchangeName, type: MarketType, symbol: string): string {
    return `${exchange}|${type}|${symbol}`;
  }

  setSnapshot(exchange: ExchangeName, type: MarketType, symbol: string, snap: Snapshot): void {
    const key = this.makeKey(exchange, type, symbol);
    if (!this.buckets.has(key)) {
      this.buckets.set(key, {
        snapshot: snap,
        bbo: snap as unknown as Bbo,
        listeners: new Set(),
        bboListeners: new Set(),
      });
    } else {
      const entry = this.buckets.get(key)!;
      entry.snapshot = snap;
    }
    // notify snapshot listeners
    const entry = this.buckets.get(key)!;
    entry.listeners.forEach((l) => l(snap));
  }

  setBbo(exchange: ExchangeName, type: MarketType, symbol: string, bbo: Bbo): void {
    const key = this.makeKey(exchange, type, symbol);
    const entry = this.buckets.get(key);
    if (!entry) {
      // create a placeholder snapshot so `getSnapshot` doesn't throw before a full snapshot arrives
      const placeholder: Snapshot = {
        exchange,
        symbol,
        type,
        bestBid: null,
        bestBidQty: 0,
        bestAsk: null,
        bestAskQty: 0,
        midPrice: null,
        bids: [],
        asks: [],
        updatedAt: bbo.timeStamp,
      };
      this.buckets.set(key, {
        snapshot: placeholder,
        bbo,
        listeners: new Set(),
        bboListeners: new Set(),
      });
    } else {
      entry.bbo = bbo;
    }
    const e = this.buckets.get(key)!;
    e.bboListeners.forEach((l) => l(bbo));
  }

  getSnapshot(exchange: ExchangeName, type: MarketType, symbol: string): Snapshot {
    const key = this.makeKey(exchange, type, symbol);
    const entry = this.buckets.get(key);
    if (!entry) {
      // Return a neutral "no data" snapshot so consuming hooks don't throw.
      return {
        exchange,
        symbol,
        type,
        bestBid: null,
        bestBidQty: 0,
        bestAsk: null,
        bestAskQty: 0,
        midPrice: null,
        bids: [],
        asks: [],
        updatedAt: Date.now(),
      };
    }
    return entry.snapshot;
  }

  getBbo(exchange: ExchangeName, type: MarketType, symbol: string): Bbo | undefined {
    const key = this.makeKey(exchange, type, symbol);
    return this.buckets.get(key)?.bbo;
  }

  subscribe(
    exchange: ExchangeName,
    type: MarketType,
    symbol: string,
    listener: Listener,
  ): () => void {
    const key = this.makeKey(exchange, type, symbol);
    if (!this.buckets.has(key)) {
      this.buckets.set(key, {
        snapshot: this.getSnapshot(exchange, type, symbol),
        bbo: this.getSnapshot(exchange, type, symbol) as unknown as Bbo,
        listeners: new Set(),
        bboListeners: new Set(),
      });
    }
    const entry = this.buckets.get(key)!;
    entry.listeners.add(listener);
    return () => {
      entry.listeners.delete(listener);
      if (entry.listeners.size === 0) {
        this.buckets.delete(key);
      }
    };
  }

  subscribeBbo(
    exchange: ExchangeName,
    type: MarketType,
    symbol: string,
    listener: BboListener,
  ): () => void {
    const key = this.makeKey(exchange, type, symbol);
    if (!this.buckets.has(key)) {
      this.buckets.set(key, {
        snapshot: this.getSnapshot(exchange, type, symbol),
        bbo: this.getSnapshot(exchange, type, symbol) as unknown as Bbo,
        listeners: new Set(),
        bboListeners: new Set(),
      });
    }
    const entry = this.buckets.get(key)!;
    entry.bboListeners.add(listener);
    return () => {
      entry.bboListeners.delete(listener);
      if (entry.bboListeners.size === 0 && entry.listeners.size === 0) {
        this.buckets.delete(key);
      }
    };
  }

  removeSymbol(exchange: ExchangeName, type: MarketType, symbol: string): void {
    this.buckets.delete(this.makeKey(exchange, type, symbol));
  }
}
