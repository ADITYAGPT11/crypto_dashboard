import { useEffect, useState } from "react";
import { LiveMarketDataService } from "../services/LiveMarketDataService";

export function useLivePrice(
  exchange: string,
  symbol: string,
  type: string
) {
  const [, forceUpdate] = useState(0);
  const service = LiveMarketDataService.getInstance();

  useEffect(() => {
    return service.subscribe(exchange, symbol, type, () => {
      forceUpdate((x) => x + 1);
    });
  }, [exchange, symbol, type]);

  return service.getPrice(exchange, symbol, type);
}
