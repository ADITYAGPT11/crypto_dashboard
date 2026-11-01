import EventEmitter from "eventemitter3";
import type {
  Candle,
  CandleData,
  CandleInterval,
  ExchangeName,
  MarketType,
} from "../types/marketData";
import { candleKey } from "../types/marketData";
import { mergeCandle, prependCandles } from "../utils/candleUtils";
import { BinanceAdapter } from "../adapters/BinanceAdapter";
import { OkxAdapter } from "../adapters/OkxAdapter";

/** Adapters that currently provide candle streams (Delta has none yet). */
interface CandleSources {
  BINANCE: BinanceAdapter;
  OKX: OkxAdapter;
}

type CandleListener = (data: CandleData) => void;

export class CandleService extends EventEmitter {
  private static instance: CandleService | null = null;

  private sources: CandleSources | null = null;

  /** key → ascending candle buffer (merged in place) */
  private buffers = new Map<string, Candle[]>();
  /** key → active listeners (WS subscriptions are refcounted) */
  private candleListeners = new Map<string, Set<CandleListener>>();
  /** key → backfill failed once (prevents refetch spam on persistent errors) */
  private backfillFailed = new Set<string>();
  /** key → backfill in flight */
  private backfilling = new Set<string>();
  /** key → one load-more-older page in flight (scroll-back load) */
  private loadingOlder = new Set<string>();
  /** key → exchange returned a short page; nothing older to load */
  private olderExhausted = new Set<string>();

  private constructor() {
    super();
  }

  static getInstance(): CandleService {
    if (!CandleService.instance) {
      CandleService.instance = new CandleService();
    }
    return CandleService.instance;
  }

  static resetInstance() {
    CandleService.instance = null;
  }

  /** Called by MarketDataService after adapters exist; tests can inject fakes. */
  wireAdapters(sources: CandleSources) {
    if (this.sources) return; // idempotent
    this.sources = sources;
    for (const adapter of [sources.BINANCE, sources.OKX]) {
      adapter.on("candle", (data: CandleData) => this.ingest(data));
    }
  }

  /**
   * Ingest a normalized candle event: merge into the buffer and fan out.
   * Also usable by tests to simulate a stream without a live socket.
   */
  ingest(data: CandleData) {
    const key = candleKey(data.exchange, data.type, data.symbol, data.interval);
    let buffer = this.buffers.get(key);
    if (!buffer) {
      buffer = [];
      this.buffers.set(key, buffer);
    }
    const before = buffer.length ? buffer[buffer.length - 1] : null;
    mergeCandle(buffer, data);
    const last = buffer[buffer.length - 1];
    // No-op only when the update didn't change the tail (older-bar replay).
    if (before && last === before) {
      return;
    }
    this.notify(key, data);
  }

  private notify(key: string, data: CandleData) {
    for (const fn of this.candleListeners.get(key) ?? []) {
      try {
        fn(data);
      } catch (e) {
        console.error("Candle listener error", e);
      }
    }
  }

  /**
   * False when older history for this key is believed exhausted (exchange
   * returned a short page) or a load is already running; the chart stops
   * requesting older pages on scroll once this flips.
   */
  hasMoreHistory(
    exchange: ExchangeName,
    type: MarketType,
    symbol: string,
    interval: CandleInterval,
  ): boolean {
    const key = candleKey(exchange, type, symbol, interval);
    return !this.olderExhausted.has(key);
  }

  /** Number of candles currently buffered for a key. */
  getBufferLength(
    exchange: ExchangeName,
    type: MarketType,
    symbol: string,
    interval: CandleInterval,
  ): number {
    return this.getCandles(exchange, type, symbol, interval).length;
  }

  /**
   * Load one page of candles older than the current buffer head and prepend
   * them (TradingView-style scroll-back). Resolves false when nothing more
   * can be loaded (exhausted, already loading, empty buffer or no source).
   * Notifies listeners of the changed buffer so the chart redraws.
   */
  async loadMoreHistory(
    exchange: ExchangeName,
    type: MarketType,
    symbol: string,
    interval: CandleInterval,
    pageSize = 1000,
  ): Promise<boolean> {
    const key = candleKey(exchange, type, symbol, interval);
    const buffer = this.buffers.get(key);
    const earliest = buffer?.[0]?.openTime;
    if (
      !buffer ||
      buffer.length === 0 ||
      earliest == null ||
      this.loadingOlder.has(key) ||
      this.olderExhausted.has(key) ||
      !this.sources
    ) {
      return false;
    }
    this.loadingOlder.add(key);
    try {
      let rows: CandleData[] = [];
      if (exchange === "BINANCE") {
        rows = await this.sources.BINANCE.fetchCandleHistory(
          symbol,
          interval,
          type === "SPOT" ? "spot" : "futures",
          pageSize,
          earliest, // endTime → strictly older klines
        );
      } else if (exchange === "OKX") {
        rows = await this.sources.OKX.fetchCandleHistory(
          symbol,
          interval,
          type === "SPOT" ? "SPOT" : "SWAP",
          pageSize,
          earliest, // page strictly older than the current buffer head
        );
      }

      const olderAsc = rows
        .filter((r) => r.candle.openTime < earliest)
        .map((r) => ({ ...r.candle }))
        .sort((a, b) => a.openTime - b.openTime);

      // A short page means the exchange has nothing older.
      if (rows.length < pageSize || olderAsc.length === 0) {
        this.olderExhausted.add(key);
      }
      const added = prependCandles(buffer, olderAsc);
      if (added === 0) {
        return false;
      }
      // Fan out with a representative event so useCandles re-reads the buffer.
      this.notify(key, {
        exchange,
        type,
        symbol,
        interval,
        candle: buffer[buffer.length - 1],
      } satisfies CandleData);
      return true;
    } catch (error) {
      console.error(`Older history failed for ${exchange} ${type} ${symbol} ${interval}:`, error);
      // Surface as exhausted for now; a later subscribe retry clears it.
      this.olderExhausted.add(key);
      return false;
    } finally {
      this.loadingOlder.delete(key);
    }
  }

  /** Current ascending snapshot for a key (empty array while loading/absent). */
  getCandles(
    exchange: ExchangeName,
    type: MarketType,
    symbol: string,
    interval: CandleInterval,
  ): Candle[] {
    return this.buffers.get(candleKey(exchange, type, symbol, interval)) ?? [];
  }

  /**
   * Subscribe to (and kick off, if needed) live candles for a key.
   * Returns an unsubscribe function. The WS subscription is released when the
   * last listener for the key unsubscribes; backfill failures are surfaced
   * through onBackfillError rather than thrown.
   */
  subscribe(
    exchange: ExchangeName,
    type: MarketType,
    symbol: string,
    interval: CandleInterval,
    listener: CandleListener,
    onBackfillError?: (error: Error) => void,
  ): () => void {
    const key = candleKey(exchange, type, symbol, interval);

    let set = this.candleListeners.get(key);
    if (!set) {
      set = new Set();
      this.candleListeners.set(key, set);
    }
    set.add(listener);

    if (!this.backfillFailed.has(key) && this.buffers.get(key)?.length === 0) {
      void this.backfill(exchange, type, symbol, interval, key, onBackfillError);
    }
    this.ensureStream(exchange, type, symbol, interval);

    return () => {
      const current = this.candleListeners.get(key);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) {
        this.candleListeners.delete(key);
        this.releaseStream(exchange, type, symbol, interval);
        // Allow later subscribers to retry a previously failed backfill.
        this.backfillFailed.delete(key);
      }
    };
  }

  private async backfill(
    exchange: ExchangeName,
    type: MarketType,
    symbol: string,
    interval: CandleInterval,
    key: string,
    onError?: (error: Error) => void,
  ) {
    if (this.backfilling.has(key) || !this.sources) return;
    this.backfilling.add(key);
    try {
      let rows: CandleData[] | undefined;
      const DESIRED_HISTORY_ROWS = 1000;
      if (exchange === "BINANCE") {
        rows = await this.sources.BINANCE.fetchCandleHistory(
          symbol,
          interval,
          type === "SPOT" ? "spot" : "futures",
          DESIRED_HISTORY_ROWS,
        );
      } else if (exchange === "OKX") {
        rows = await this.sources.OKX.fetchCandleHistory(
          symbol,
          interval,
          type === "SPOT" ? "SPOT" : "SWAP",
          DESIRED_HISTORY_ROWS, // OKX pages internally (300 rows per request)
        );
      }
      if (!this.candleListeners.has(key)) return; // unsubscribed mid-backfill
      // Ingest oldest-first so live updates landing mid-backfill stay on top.
      for (let i = (rows?.length ?? 0) - 1; i >= 0; i--) {
        this.ingest(rows![i]);
      }
    } catch (error) {
      console.error(`No candle history for ${exchange} ${type} ${symbol} ${interval}:`, error);
      this.backfillFailed.add(key);
      onError?.(error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.backfilling.delete(key);
    }
  }

  private ensureStream(
    exchange: ExchangeName,
    type: MarketType,
    symbol: string,
    interval: CandleInterval,
  ) {
    if (exchange === "BINANCE") {
      this.sources?.BINANCE.subscribeCandles(
        symbol,
        interval,
        type === "SPOT" ? "spot" : "futures",
      );
    } else if (exchange === "OKX") {
      this.sources?.OKX.subscribeCandles(symbol, type === "SPOT" ? "SPOT" : "SWAP", interval);
    }
    // DELTA: no candle stream in scope yet (documented limitation, AGENT.md).
  }

  private releaseStream(
    exchange: ExchangeName,
    type: MarketType,
    symbol: string,
    interval: CandleInterval,
  ) {
    if (exchange === "BINANCE") {
      this.sources?.BINANCE.unsubscribeCandles(
        symbol,
        interval,
        type === "SPOT" ? "spot" : "futures",
      );
    } else if (exchange === "OKX") {
      this.sources?.OKX.unsubscribeCandles(symbol, type === "SPOT" ? "SPOT" : "SWAP", interval);
    }
  }
}
