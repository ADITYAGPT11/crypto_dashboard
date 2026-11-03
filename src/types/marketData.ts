/**
 * Normalized market data emitted by every exchange adapter.
 * Types are the single contract between adapters and everything downstream:
 * exchange-specific fields must never leak past this layer.
 */
export type ExchangeName = "BINANCE" | "OKX" | "DELTA";

export type MarketType = "SPOT" | "FUT";
export type GenericMarketData = {
  exchange: ExchangeName;
  /**
   * Canonical BASE-QUOTE row key (e.g. BTC-USDT). Delta India instruments are
   * USD-quoted but share the asset's row; `quote` says what the price is in.
   */
  symbol: string;
  /** Currency the price is quoted in; omitted means USDT. */
  quote?: "USDT" | "USD";
  type: MarketType;
  currentPrice: number;
  /** Event timestamp in epoch milliseconds (adapters normalize to ms). */
  timeStamp: number;
};

export interface CanonicalSymbol {
  base: string;
  quote: string;
}
export interface ArbitrageSide {
  exchange: string;
  price: number;
}

/**
 * Cross-exchange last-price spread for one symbol.
 *
 * NOTE (data honesty): public WebSocket feeds give us last traded prices, not
 * executable bid/ask. `lowest`/`highest` are *reference* prices, and the
 * spread is indicative only — it may not be executable.
 */
export interface ArbitrageOpportunity {
  symbol: string;
  marketType: MarketType;
  /** (highest - lowest) / lowest * 100 */
  spreadPercent: number;
  lowest: ArbitrageSide;
  highest: ArbitrageSide;
  /** Epoch ms of the most recent underlying price update. */
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Candles (Module 4 — charting)
// ---------------------------------------------------------------------------

/**
 * Supported candle intervals in this scope. Textual form (lowercase, numeral)
 * is our canonical representation; adapters map to their native spelling.
 */
export type CandleInterval = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";
export const CANDLE_INTERVALS: readonly CandleInterval[] = ["1m", "5m", "15m", "1h", "4h", "1d"];

export const CANDLEBVALS = ["1m", "5m", "15m", "1h", "4h", "1d"];

/**
 * One OHLCV candle, always open-high-low-close ascending by openTime.
 * `volume` is the traded base-asset volume when the source provides it,
 * otherwise upstream quote-equivalent volume (see ChartPanel's limit note).
 */
export interface Candle {
  /** Interval start in epoch milliseconds (normalized to ms by adapters). */
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** True when the candle period has elapsed and the candle is final. */
  closed?: boolean;
}

/**
 * A normalized candle event coming from an exchange WS kline stream or the
 * REST history backfill. This is the module-4 analogue of GenericMarketData.
 */
export interface CandleData {
  exchange: ExchangeName;
  symbol: string; // canonical BASE-QUOTE
  type: MarketType;
  interval: CandleInterval;
  candle: Candle;
}

/** Stable key for candle buffers/subscriptions. */
export function candleKey(
  exchange: ExchangeName,
  type: MarketType,
  symbol: string,
  interval: CandleInterval,
): string {
  return `${exchange}|${type}|${symbol}|${interval}`;
}

// ---------------------------------------------------------------------------
// Order book (Module 5 — order-book analytics)
// ---------------------------------------------------------------------------

/**
 * A single price level in a visible order book.
 *
 * Data honesty: only the *resting* orders visible on the public feed are
 * represented. The source cannot be confirmed from a public feed, and spoofed
 * or soon-cancelled levels are indistinguishable from genuine resting orders
 * here.
 */
export interface OrderBookLevel {
  price: number;
  quantity: number;
  /** Last update timestamp (adapter-normalized to ms). */
  updatedAt: number;
}

/**
 * Best bid/ask snapshot (one "snapshot" event per symbol/source).
 * Built from normalized depth diff streams and mirrored into the UI panel.
 */
export interface OrderBookSnapshot {
  exchange: ExchangeName;
  symbol: string;
  type: MarketType;
  bestBid: number | null;
  bestBidQty: number | null;
  bestAsk: number | null;
  bestAskQty: number | null;
  midPrice: number | null;
  /** Resting visible bids, highest price first. */
  bids: OrderBookLevel[];
  /** Resting visible asks, lowest price first. */
  asks: OrderBookLevel[];
  updatedAt: number;
}

/**
 * Best bid/ask snapshot (one "Bbo" event per symbol/source).
 */
export interface OrderBookBbo {
  exchange: ExchangeName;
  symbol: string;
  type: MarketType;
  bidPrice: number;
  bidQuantity: number;
  askPrice: number;
  askQuantity: number;
  timeStamp: number;
}

// ---------------------------------------------------------------------------
// Trade prints (Module 5 — order-flow analytics)
// ---------------------------------------------------------------------------

/**
 * One executed public trade (the exchange's aggregate trade where fills are
 * merged).
 *
 * Data honesty: the aggressor side is inferred from the exchange's
 * buyer-is-maker flag; a public feed cannot attribute a print to a specific
 * account, order or algorithm.
 */
export interface TradeEvent {
  exchange: ExchangeName;
  symbol: string; // canonical BASE-QUOTE
  type: MarketType;
  price: number;
  /** Traded quantity in base-asset units. */
  quantity: number;
  /** True when the buyer was the resting side → aggressor (taker) sold. */
  buyerMaker: boolean /** Epoch ms of the trade (adapter-normalized to ms). */;
  timeStamp: number;
}

// ---------------------------------------------------------------------------
// 24h ticker stats (Module 3 — dashboard change% / volume)
// ---------------------------------------------------------------------------

/**
 * Per-feed 24h rollup fetched from the exchanges' public REST tickers
 * (poll-refreshed; WS feeds don't carry 24h rollups in our scope).
 *
 * Data honesty: these are the exchange's own 24h figures, refreshed every
 * REST cycle — not computed from our WS stream and not real-time.
 */
export interface TickerStats {
  exchange: ExchangeName;
  symbol: string;
  type: MarketType;
  /** 24h price change in percent (exchange-reported or derived from open24h). */
  changePercent: number | null;
  /** 24h traded volume in base-asset units (e.g. BTC), as reported upstream. */
  volumeBase: number | null;
  /** Epoch ms of the successful REST refresh; null when never fetched. */
  updatedAt: number | null;
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

/** Stable key for order-book snapshot/bbo tracking. */
export function orderBookKey(exchange: ExchangeName, type: MarketType, symbol: string): string {
  return `${exchange}|${type}|${symbol}`;
}

/** Stable key for 24h ticker-stats tracking. */
export function tickerStatsKey(exchange: ExchangeName, type: MarketType, symbol: string): string {
  return `${exchange}|${type}|${symbol}`;
}
