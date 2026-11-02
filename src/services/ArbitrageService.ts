import EventEmitter from "eventemitter3";
import type { ArbitrageOpportunity, GenericMarketData } from "../types/marketData";

/**
 * Cross-exchange last-price comparison engine.
 *
 * Because public WebSocket feeds deliver last traded prices (not executable
 * bid/ask), the output is an *indicative* spread: buy-side vs sell-side
 * reference prices. It is NOT an executable arbitrage quote.
 *
 * Consumes normalized price updates via onPriceUpdate() and, whenever the
 * spread for a symbol changes (beyond display precision), emits "arbitrage"
 * with the full ArbitrageOpportunity record.
 */
export class ArbitrageService extends EventEmitter {
  /** `${marketType}|${symbol}` → exchange → latest last price */
  private latest = new Map<string, Map<string, number>>();
  /** `${marketType}|${symbol}` → most recent underlying tick timestamp */
  private latestTs = new Map<string, number>();
  /** `${marketType}|${symbol}` → spread percent last emitted (avoids UI spam) */
  private lastEmitted = new Map<string, number>();
  private thresholdPercent: number;

  constructor(options: { thresholdPercent?: number } = {}) {
    super();
    this.thresholdPercent = options.thresholdPercent ?? 0.1;
  }

  private static key(marketType: string, symbol: string): string {
    return `${marketType}|${symbol}`;
  }

  onPriceUpdate(msg: GenericMarketData) {
    // Only like-for-like quotes: a USD price vs a USDT price is partly the USDT/USD rate.
    if ((msg.quote ?? "USDT") !== "USDT") return;
    const key = ArbitrageService.key(msg.type, msg.symbol);

    let byExchange = this.latest.get(key);
    if (!byExchange) {
      byExchange = new Map();
      this.latest.set(key, byExchange);
    }
    byExchange.set(msg.exchange, msg.currentPrice);
    this.latestTs.set(key, msg.timeStamp);

    if (byExchange.size < 2) return; // need 2+ exchanges to compare

    let lowest: { exchange: string; price: number } | null = null;
    let highest: { exchange: string; price: number } | null = null;
    for (const [exchange, price] of byExchange) {
      if (price <= 0) continue;
      if (!lowest || price < lowest.price) lowest = { exchange, price };
      if (!highest || price > highest.price) highest = { exchange, price };
    }
    if (!lowest || !highest || lowest.exchange === highest.exchange) return;

    const spreadPercent = ((highest.price - lowest.price) / lowest.price) * 100;
    if (spreadPercent < this.thresholdPercent) return;

    const rounded = Number(spreadPercent.toFixed(3));
    if (this.lastEmitted.get(key) === rounded) return; // unchanged → no re-render
    this.lastEmitted.set(key, rounded);

    const opportunity: ArbitrageOpportunity = {
      symbol: msg.symbol,
      marketType: msg.type,
      spreadPercent: rounded,
      lowest,
      highest,
      updatedAt: this.latestTs.get(key) ?? Date.now(),
    };
    this.emit("arbitrage", opportunity);
  }

  /** Drop a symbol from tracking after it is removed from the watchlist. */
  forgetSymbol(symbol: string) {
    const prefix = `|${symbol}`;
    for (const key of Array.from(this.latest.keys())) {
      if (key.endsWith(prefix)) {
        this.latest.delete(key);
        this.lastEmitted.delete(key);
        this.latestTs.delete(key);
      }
    }
  }
}
