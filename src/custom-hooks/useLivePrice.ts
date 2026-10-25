import { useEffect, useState } from "react";
import { LiveMarketDataService } from "../services/LiveMarketDataService";

export interface LivePrice {
  /** Latest normalized price, or null if nothing has arrived yet. */
  price: number | null;
  /** Epoch ms of the last received tick, or null. */
  updatedAt: number | null;
}

/**
 * Subscribe to a single live price cell (exchange|symbol|type).
 * Re-renders only when that exact feed reports a new tick.
 */
export function useLivePrice(exchange: string, symbol: string, type: string): LivePrice {
  const [, forceUpdate] = useState(0);
  const service = LiveMarketDataService.getInstance();

  useEffect(() => {
    return service.subscribe(exchange, symbol, type, () => {
      forceUpdate((x) => x + 1);
    });
  }, [exchange, symbol, type, service]);

  return {
    price: service.getPrice(exchange, symbol, type),
    updatedAt: service.getLastUpdatedAt(exchange, symbol, type),
  };
}
