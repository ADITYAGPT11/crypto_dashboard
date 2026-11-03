import { useSyncExternalStore } from "react";
import { MarketOverviewService, type MarketOverview } from "../services/MarketOverviewService";

// Stable functions: an inline subscribe would make React re-subscribe on every
// render, which here would stop and restart polling each time.
const subscribe = (cb: () => void) => MarketOverviewService.getInstance().subscribe(cb);
const getSnapshot = () => MarketOverviewService.getInstance().getSnapshot();

/** Live market overview; polling runs only while a component uses this. */
export function useMarketOverview(): MarketOverview {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
