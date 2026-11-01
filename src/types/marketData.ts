export type GenericMarketData = {
  exchange: "BINANCE" | "OKX" | "DELTA";
  symbol: string;
  type: "SPOT" | "FUT";
  currentPrice: number;
  timeStamp: number;
};

export interface CanonicalSymbol {
  base: string;
  quote: string;
}
