export interface OrderBookEntry {
  price: number;
  quantity: number;
}

export interface OrderBook {
  exchange: "BINANCE" | "OKX";
  symbol: string;
  bids: OrderBookEntry[];
  asks: OrderBookEntry[];
  timestamp: number;
}
