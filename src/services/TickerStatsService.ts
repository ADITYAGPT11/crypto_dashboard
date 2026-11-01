/**
 * 24h ticker-stats store: keyed (exchange | type | symbol) → TickerStats,
 * REST-polled while a UI consumer is subscribed (mirrors the
 * OrderBookService/CandleService listener pattern).
 *
 * Data honesty (roadmap): the exchanges report their own 24h rollups over
 * REST. We refresh every REST_24H_REFRESH_MS and surface `updatedAt`, so the
 * UI can label these figures as polling-refreshed rather than real-time.
 *
 * Exchange coverage limitation (same as candles): Delta has no wired 24h
 * stats source yet; unreachable REST hosts degrade to "no stats" silently.
 */
import type { ExchangeName, MarketType, TickerStats } from "../types/marketData";
import { tickerStatsKey } from "../types/marketData";
import { parseBinance24hTicker, parseOkx24hTicker } from "../utils/tickerStats";

/** REST cycles are deliberately slow: these are 24h rollups, not live ticks. */
export const REST_24H_REFRESH_MS = 60_000;

type Listener = (stats: TickerStats | null) => void;

interface Bucket {
  stats: TickerStats | null;
  listeners: Set<Listener>;
  timer: number | null;
  inflight: boolean;
}

/** REST endpoint templates per exchange/market; null = no source wired yet. */
const REST_24H_URLS: Record<ExchangeName, Record<MarketType, string> | null> = {
  BINANCE: {
    SPOT: "https://api.binance.com/api/v3/ticker/24hr?symbol={wire}",
    FUT: "https://fapi.binance.com/fapi/v1/ticker/24hr?symbol={wire}",
  },
  OKX: {
    SPOT: "https://www.okx.com/api/v5/market/ticker?instId={symbol}",
    FUT: "https://www.okx.com/api/v5/market/ticker?instId={symbol}-SWAP",
  },
  // Delta lacks a wired public 24h rollup in this scope (documented limitation).
  DELTA: null,
};

/** BTC-USDT → BTCUSDT for the query string. */
function toWireSymbol(symbol: string): string {
  return symbol.replace("-", "").toUpperCase();
}

export class TickerStatsService {
  private buckets = new Map<string, Bucket>();
  private static instance: TickerStatsService | null = null;

  private constructor() {}

  static getInstance(): TickerStatsService {
    if (!TickerStatsService.instance) {
      TickerStatsService.instance = new TickerStatsService();
    }
    return TickerStatsService.instance;
  }

  static resetInstance() {
    TickerStatsService.instance = null;
  }

  getSnapshot(exchange: ExchangeName, type: MarketType, symbol: string): TickerStats | null {
    return this.buckets.get(tickerStatsKey(exchange, type, symbol))?.stats ?? null;
  }

  subscribe(
    exchange: ExchangeName,
    type: MarketType,
    symbol: string,
    listener: Listener,
  ): () => void {
    const key = tickerStatsKey(exchange, type, symbol);
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { stats: null, listeners: new Set(), timer: null, inflight: false };
      this.buckets.set(key, bucket);
    }
    bucket.listeners.add(listener);
    if (bucket.timer === null) {
      this.startPolling(exchange, type, symbol, bucket);
    }
    return () => {
      const current = this.buckets.get(key);
      if (!current) return;
      current.listeners.delete(listener);
      if (current.listeners.size === 0 && current.timer !== null) {
        window.clearInterval(current.timer);
        current.timer = null;
      }
    };
  }

  private startPolling(exchange: ExchangeName, type: MarketType, symbol: string, bucket: Bucket) {
    bucket.timer = window.setInterval(() => {
      void this.refresh(exchange, type, symbol, bucket);
    }, REST_24H_REFRESH_MS);
    void this.refresh(exchange, type, symbol, bucket);
  }

  /** One REST cycle. Silently keeps the previous stats on transient failures. */
  async refresh(
    exchange: ExchangeName,
    type: MarketType,
    symbol: string,
    bucket: Bucket,
  ): Promise<void> {
    const template = REST_24H_URLS[exchange];
    const urlTemplate = template?.[type];
    if (!urlTemplate || bucket.inflight) return;
    bucket.inflight = true;
    try {
      const url = urlTemplate.replace("{wire}", toWireSymbol(symbol)).replace("{symbol}", symbol);
      const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = (await response.json()) as unknown;
      const parsed =
        exchange === "BINANCE"
          ? parseBinance24hTicker(payload)
          : exchange === "OKX"
            ? parseOkx24hTicker(payload)
            : null;
      if (!parsed) throw new Error("Unrecognized payload");
      const next: TickerStats = {
        exchange,
        symbol,
        type,
        changePercent: parsed.changePercent,
        volumeBase: parsed.volumeBase,
        updatedAt: Date.now(),
      };
      bucket.stats = next;
      for (const l of bucket.listeners) l(next);
    } catch (error) {
      // Keep the last known stats; log at the service boundary for devtools.
      if (bucket.stats === null) {
        console.warn(`No 24h stats for ${exchange} ${type} ${symbol}:`, error);
      }
    } finally {
      bucket.inflight = false;
    }
  }
}
