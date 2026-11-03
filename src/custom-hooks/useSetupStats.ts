import { useSyncExternalStore } from "react";
import { SetupStatsService } from "../services/SetupStatsService";
import { researchUniverse } from "./useScan";

const svc = () => SetupStatsService.getInstance(researchUniverse);
const subscribe = (cb: () => void) => svc().subscribe(cb);
const getVersion = () => svc().getVersion();

/**
 * The background setup-statistics service; re-renders when any context's
 * stats change. Call `service.request(ctx, priority)` and `service.get(ctx)`.
 */
export function useSetupStats(): SetupStatsService {
  useSyncExternalStore(subscribe, getVersion, getVersion);
  return svc();
}
