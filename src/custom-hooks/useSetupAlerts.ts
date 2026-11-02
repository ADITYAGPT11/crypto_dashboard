import { useSyncExternalStore } from "react";
import { SetupAlertService, type SetupAlertSnapshot } from "../services/SetupAlertService";

/** Live setup-alert rules, firings and Telegram status. */
export function useSetupAlerts(): SetupAlertSnapshot {
  const svc = SetupAlertService.getInstance();
  return useSyncExternalStore((cb) => svc.subscribe(cb), svc.getSnapshot, svc.getSnapshot);
}
