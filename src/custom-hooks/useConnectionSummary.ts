import { useEffect, useState } from "react";
import { MarketDataService } from "../services/MarketDataService";
import type { ConnectionState } from "../types/connection";

/** Live connection state per exchange, as aggregated by MarketDataService. */
export function useConnectionSummary(): Record<string, ConnectionState> {
  const [states, setStates] = useState<Record<string, ConnectionState>>({});
  useEffect(() => {
    const service = MarketDataService.getInstance();
    const onStatus = (s: { exchange: string; state: ConnectionState }) =>
      setStates((prev) =>
        prev[s.exchange] === s.state ? prev : { ...prev, [s.exchange]: s.state },
      );
    service.on("connectionStatus", onStatus);
    return () => {
      service.off("connectionStatus", onStatus);
    };
  }, []);
  return states;
}
