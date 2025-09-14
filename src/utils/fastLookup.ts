/**
 * Ultra-fast lookup data structure for market data
 * Optimized for O(1) lookups and minimal memory allocation
 */
export class FastMarketDataLookup {
  private data = new Map<string, {
    exchange: "Binance" | "OKX";
    symbol: string;
    type: "SPOT" | "FUT";
    currentPrice: number;
    timeStamp: number;
  }>();

  update(exchange: "Binance" | "OKX", symbol: string, type: "SPOT" | "FUT", currentPrice: number, timeStamp: number) {
    // Use symbol as-is for key
    const key = `${exchange}:${symbol}:${type}`;
    this.data.set(key, { exchange, symbol, type, currentPrice, timeStamp });
  }

  getPrice(exchange: string, symbol: string, type: string): number | null {
    const key = `${exchange}:${symbol}:${type}`;
    return this.data.get(key)?.currentPrice || null;
  }

  getAllData() {
    const result = Array.from(this.data.values());
    return result;
  }

  getExchanges(): string[] {
    const exchanges = new Set<string>();
    for (const item of this.data.values()) {
      exchanges.add(item.exchange);
    }
    return Array.from(exchanges);
  }

  getTypes(): string[] {
    const types = new Set<string>();
    for (const item of this.data.values()) {
      types.add(item.type);
    }
    return Array.from(types);
  }

  clear() {
    this.data.clear();
  }
}
