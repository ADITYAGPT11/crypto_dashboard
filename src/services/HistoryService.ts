import type { Candle, CandleInterval } from "../types/marketData";
import { normalizeHistory } from "../utils/candleUtils";

/**
 * Deep candle history for analysis (patterns, zones, setup statistics).
 *
 * Phase 1a: fetched in the browser from Binance USDⓈ-M futures public REST
 * (no key), paged backwards, cached per symbol × interval for the session.
 * Phase 1b replaces this with the backend's stored history (QuestDB).
 */

export const INTERVAL_MS: Record<CandleInterval, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "1h": 3_600_000,
  "4h": 14_400_000,
  "1d": 86_400_000,
};

const PAGE_LIMIT = 1500; // Binance futures maximum per request
const DEFAULT_PAGES = 2; // ≈ 3000 candles: ~500 days of 4h
const FETCH_TIMEOUT_MS = 15_000;

export interface History {
  symbol: string;
  interval: CandleInterval;
  /** Closed candles only, ascending. */
  candles: Candle[];
  fetchedAt: number;
}

type Fetcher = (url: string) => Promise<unknown>;

const defaultFetcher: Fetcher = async (url) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Binance history HTTP ${res.status}`);
  return res.json();
};

export function toBinanceSymbol(symbol: string): string {
  return symbol.replace("-", "").toUpperCase();
}

export class HistoryService {
  private static instance: HistoryService | null = null;
  private cache = new Map<string, Promise<History>>();

  constructor(
    private fetcher: Fetcher = defaultFetcher,
    private now: () => number = Date.now,
  ) {}

  static getInstance(): HistoryService {
    if (!HistoryService.instance) HistoryService.instance = new HistoryService();
    return HistoryService.instance;
  }

  static resetInstance() {
    HistoryService.instance = null;
  }

  /** Cached; a failed load is evicted so the next call retries. */
  load(symbol: string, interval: CandleInterval, pages = DEFAULT_PAGES): Promise<History> {
    const key = `${symbol}|${interval}|${pages}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const p = this.fetchPages(symbol, interval, pages).catch((err: unknown) => {
      this.cache.delete(key);
      throw err;
    });
    this.cache.set(key, p);
    return p;
  }

  private async fetchPages(
    symbol: string,
    interval: CandleInterval,
    pages: number,
  ): Promise<History> {
    let all: Candle[] = [];
    let endTime: number | undefined;
    for (let page = 0; page < pages; page++) {
      const url =
        `https://fapi.binance.com/fapi/v1/klines?symbol=${toBinanceSymbol(symbol)}` +
        `&interval=${interval}&limit=${PAGE_LIMIT}${endTime != null ? `&endTime=${endTime}` : ""}`;
      const rows = (await this.fetcher(url)) as unknown[];
      const batch = normalizeHistory(
        (Array.isArray(rows) ? rows : []).map((r) => {
          const row = r as [number, string, string, string, string, string];
          return {
            openTime: row[0],
            open: parseFloat(row[1]),
            high: parseFloat(row[2]),
            low: parseFloat(row[3]),
            close: parseFloat(row[4]),
            volume: parseFloat(row[5]),
          };
        }),
      );
      if (batch.length === 0) break;
      all = mergeAscending(batch, all);
      if (batch.length < PAGE_LIMIT) break;
      endTime = batch[0].openTime - 1;
    }
    const cutoff = this.now();
    const closed = all.filter((c) => c.openTime + INTERVAL_MS[interval] <= cutoff);
    return { symbol, interval, candles: closed, fetchedAt: cutoff };
  }
}

/** Merge two ascending candle lists, dropping duplicate open times. */
function mergeAscending(older: Candle[], newer: Candle[]): Candle[] {
  const seen = new Set<number>();
  const out: Candle[] = [];
  for (const c of [...older, ...newer]) {
    if (seen.has(c.openTime)) continue;
    seen.add(c.openTime);
    out.push(c);
  }
  return out.sort((a, b) => a.openTime - b.openTime);
}

/**
 * Coins every setup is pooled across, in addition to the user's watchlist.
 * Liquid Binance USDⓈ-M perpetuals with long histories.
 */
export const RESEARCH_UNIVERSE: readonly string[] = [
  "BTC-USDT",
  "ETH-USDT",
  "SOL-USDT",
  "XRP-USDT",
  "BNB-USDT",
  "DOGE-USDT",
  "ADA-USDT",
  "AVAX-USDT",
  "LINK-USDT",
  "LTC-USDT",
];
