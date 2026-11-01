import { useEffect, useState } from "react";
import { TickerStatsService } from "../services/TickerStatsService";
import type { ExchangeName, MarketType, TickerStats } from "../types/marketData";

/**
 * 24h change% / volume for one (exchange, type, symbol) feed.
 * Returns null until the first successful REST cycle (or permanently for
 * exchanges without a wired 24h source). Uses the shared forceUpdate pattern.
 */
export function useTickerStats(
  exchange: ExchangeName,
  symbol: string,
  type: MarketType,
): TickerStats | null {
  const [, forceUpdate] = useState(0);
  const service = TickerStatsService.getInstance();

  useEffect(() => {
    return service.subscribe(exchange, type, symbol, () => {
      forceUpdate((x) => x + 1);
    });
  }, [exchange, type, symbol, service]);

  return service.getSnapshot(exchange, type, symbol);
}
