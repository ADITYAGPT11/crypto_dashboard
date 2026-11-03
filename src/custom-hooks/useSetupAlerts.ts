import { useSyncExternalStore } from "react";
import { SetupAlertService, type SetupAlertSnapshot } from "../services/SetupAlertService";

// Stable functions so React doesn't re-subscribe on every render.
const subscribe = (cb: () => void) => SetupAlertService.getInstance().subscribe(cb);
const getSnapshot = () => SetupAlertService.getInstance().getSnapshot();

/** Live setup-alert rules, firings and Telegram status. */
export function useSetupAlerts(): SetupAlertSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
