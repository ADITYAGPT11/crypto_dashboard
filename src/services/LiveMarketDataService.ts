type PriceKey = string; // exchange|symbol|type
type Listener = () => void;

export interface FundingRateSnapshot {
  rate: number;
  nextFundingTime: number;
  fundingInterval?: number; // seconds (e.g. 28800 for 8h)
  nextFundingRate?: number; // predicted rate for next period
}

export class LiveMarketDataService {
  private prices = new Map<PriceKey, number>();
  private fundingRates = new Map<PriceKey, FundingRateSnapshot>();
  private listeners = new Map<PriceKey, Set<Listener>>();
  private frListeners = new Map<PriceKey, Set<Listener>>();

  private static instance: LiveMarketDataService;

  static getInstance() {
    if (!this.instance) {
      this.instance = new LiveMarketDataService();
    }
    return this.instance;
  }

  private makeKey(exchange: string, symbol: string, type: string): PriceKey {
    return `${exchange}|${symbol}|${type}`;
  }

  update(
    exchange: string,
    symbol: string,
    type: string,
    price: number
  ) {
    const key = this.makeKey(exchange, symbol, type);
    this.prices.set(key, price);

    const subs = this.listeners.get(key);
    if (subs) {
      subs.forEach((cb) => cb());
    }
  }

  getPrice(exchange: string, symbol: string, type: string) {
    return this.prices.get(this.makeKey(exchange, symbol, type)) ?? null;
  }

  subscribe(
    exchange: string,
    symbol: string,
    type: string,
    cb: Listener
  ) {
    const key = this.makeKey(exchange, symbol, type);

    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set());
    }

    this.listeners.get(key)!.add(cb);

    return () => {
      this.listeners.get(key)?.delete(cb);
    };
  }

  // --- Funding Rate ---

  updateFundingRate(exchange: string, symbol: string, fr: FundingRateSnapshot) {
    const key = this.makeKey(exchange, symbol, "FUT");
    this.fundingRates.set(key, fr);

    const subs = this.frListeners.get(key);
    if (subs) {
      subs.forEach((cb) => cb());
    }
  }

  getFundingRate(exchange: string, symbol: string): FundingRateSnapshot | null {
    return this.fundingRates.get(this.makeKey(exchange, symbol, "FUT")) ?? null;
  }

  subscribeFundingRate(
    exchange: string,
    symbol: string,
    cb: Listener
  ) {
    const key = this.makeKey(exchange, symbol, "FUT");

    if (!this.frListeners.has(key)) {
      this.frListeners.set(key, new Set());
    }

    this.frListeners.get(key)!.add(cb);

    return () => {
      this.frListeners.get(key)?.delete(cb);
    };
  }
}
