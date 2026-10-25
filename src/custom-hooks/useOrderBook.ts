import { useEffect, useState } from "react";
import { OrderBookService } from "../services/OrderBookService";
import type { ExchangeName, MarketType, OrderBookSnapshot } from "../types/marketData";

export function useOrderBook(
  exchange: ExchangeName,
  symbol: string,
  type: MarketType,
): OrderBookSnapshot {
  const [, forceUpdate] = useState(0);
  const service = OrderBookService.getInstance();

  useEffect(() => {
    return service.subscribe(exchange, type, symbol, () => {
      forceUpdate((x) => x + 1);
    });
  }, [exchange, symbol, type, service]);

  return service.getSnapshot(exchange, type, symbol);
}
