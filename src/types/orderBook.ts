export interface OrderBookEntry {
  price: number;
  quantity: number;
}

export interface OrderBook {
  exchange: "Binance" | "OKX";
  symbol: string;
  bids: OrderBookEntry[];
  asks: OrderBookEntry[];
  timestamp: number;
}
