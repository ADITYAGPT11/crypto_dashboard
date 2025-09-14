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