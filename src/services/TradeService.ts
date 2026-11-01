/**
 * A keyed rolling store of public trade prints (Module 5).
 *
 * Keeps the last MAX_TRADES_PER_KEY prints per (exchange, type, symbol) key
 * and fans each trade out to subscribers. The adapter layer does not emit
 * trade prints for OKX/Delta yet (documented limitation) — the store degrades
 * gracefully to an empty list for those sources.
 */
import { EventEmitter } from "eventemitter3";
import type { ExchangeName, MarketType, TradeEvent } from "../types/marketData";

export const MAX_TRADES_PER_KEY = 250;

export interface TradeBucket {
  /** Trades, oldest first. */
  trades: TradeEvent[];
  listeners: Set<(t: TradeEvent) => void>;
}

export class TradeService extends EventEmitter {
  private static instance: TradeService | null = null;
  private buckets = new Map<string, TradeBucket>();

  static getInstance(): TradeService {
    if (!TradeService.instance) {
      TradeService.instance = new TradeService();
    }
    return TradeService.instance;
  }

  static resetInstance() {
    TradeService.instance = null;
  }

  makeKey(exchange: ExchangeName, type: MarketType, symbol: string): string {
    return `${exchange}|${type}|${symbol}`;
  }

  /** Ingest one trade: append (or trim) to the rolling buffer and fan out. */
  addTrade(trade: TradeEvent): void {
    const key = this.makeKey(trade.exchange, trade.type, trade.symbol);
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { trades: [], listeners: new Set() };
      this.buckets.set(key, bucket);
    }
    bucket.trades.push(trade);
    if (bucket.trades.length > MAX_TRADES_PER_KEY) {
      bucket.trades.splice(0, bucket.trades.length - MAX_TRADES_PER_KEY);
    }
    for (const fn of bucket.listeners) {
      try {
        fn(trade);
      } catch (e) {
        console.error("Trade listener error", e);
      }
    }
    this.emit("trade", trade);
  }

  /** Rolling buffer for a key (oldest first); empty when nothing received yet. */
  getTrades(exchange: ExchangeName, type: MarketType, symbol: string): TradeEvent[] {
    return this.buckets.get(this.makeKey(exchange, type, symbol))?.trades ?? [];
  }

  /** Subscribe to live trades for a key; returns an unsubscribe function. */
  subscribe(
    exchange: ExchangeName,
    type: MarketType,
    symbol: string,
    listener: (t: TradeEvent) => void,
  ): () => void {
    const key = this.makeKey(exchange, type, symbol);
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { trades: [], listeners: new Set() };
      this.buckets.set(key, bucket);
    }
    bucket.listeners.add(listener);
    return () => {
      bucket.listeners.delete(listener);
      // Buffer is modest (ring-capped); unlike OrderBookService we keep the
      // prints after the last listener leaves so a re-subscribe sees history.
    };
  }

  removeSymbol(exchange: ExchangeName, type: MarketType, symbol: string): void {
    this.buckets.delete(this.makeKey(exchange, type, symbol));
  }
}
