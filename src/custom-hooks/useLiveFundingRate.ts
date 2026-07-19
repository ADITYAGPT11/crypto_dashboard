import { useEffect, useState } from "react";
import { LiveMarketDataService } from "../services/LiveMarketDataService";

export function useLiveFundingRate(
  exchange: string,
  symbol: string
) {
  const [, forceUpdate] = useState(0);
  const service = LiveMarketDataService.getInstance();

  useEffect(() => {
    return service.subscribeFundingRate(exchange, symbol, () => {
      forceUpdate((x) => x + 1);
    });
  }, [exchange, symbol, service]);

  return service.getFundingRate(exchange, symbol);
}
