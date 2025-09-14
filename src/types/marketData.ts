export type GenericMarketData = {
  exchange: "Binance" | "OKX";
  symbol: string;
  type: "SPOT" | "FUT";
  currentPrice: number;
  timeStamp: number;
};

export interface CanonicalSymbol {
  base: string;
  quote: string;
}

export interface ArbitrageOpportunity {
  symbol: string;
  spread: number;
  spreadPercent: number;
  bestAsk: { exchange: string; price: number };
  bestBid: { exchange: string; price: number };
}