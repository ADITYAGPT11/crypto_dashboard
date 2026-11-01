import { useEffect, useState } from "react";
import { TradeService } from "../services/TradeService";
import type { ExchangeName, MarketType, TradeEvent } from "../types/marketData";

/**
 * Rolling window of public trade prints for one (exchange, type, symbol).
 * Mirrors the forceUpdate-on-notify pattern of the other hooks; returns the
 * service's live buffer (do not mutate in place).
 */
export function useTrades(
  exchange: ExchangeName,
  type: MarketType,
  symbol: string,
  count = 30,
): TradeEvent[] {
  const [, forceUpdate] = useState(0);
  const service = TradeService.getInstance();

  useEffect(() => {
    return service.subscribe(exchange, type, symbol, () => {
      forceUpdate((x) => x + 1);
    });
  }, [exchange, type, symbol, service]);

  const trades = service.getTrades(exchange, type, symbol);
  return trades.length > count ? trades.slice(trades.length - count) : trades;
}
