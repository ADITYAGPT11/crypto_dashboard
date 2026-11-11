import { useCallback, useSyncExternalStore } from "react";
import type { ApiResource, ResourceState } from "../services/ApiResource";
import {
  analysisApi,
  analysisKey,
  scannerKey,
  setupDetailKey,
  statsKey,
} from "../services/AnalysisApi";
import type { AnalysisOut, CatalogOut, ScannerOut, SetupDetailOut, StatsOut } from "../api/schema";
import type { CandleInterval } from "../types/marketData";

const IDLE: ResourceState<never> = { data: null, error: null, loading: false, updatedAt: null };

/** Subscribe to one key of a resource; `null` key = nothing requested. */
export function useResource<T>(res: ApiResource<T>, key: string | null): ResourceState<T> {
  const subscribe = useCallback(
    (cb: () => void) => (key === null ? () => {} : res.subscribe(key, cb)),
    [res, key],
  );
  const get = useCallback(() => (key === null ? IDLE : res.get(key)), [res, key]);
  return useSyncExternalStore(subscribe, get, get);
}

export function useCatalog(): ResourceState<CatalogOut> {
  return useResource(analysisApi().catalog, "catalog");
}

export function useAnalysis(
  symbol: string | null,
  tf: CandleInterval,
  zoneTf: CandleInterval,
): ResourceState<AnalysisOut> {
  return useResource(analysisApi().analysis, symbol ? analysisKey(symbol, tf, zoneTf) : null);
}

export function useStats(tf: CandleInterval, zoneTf: CandleInterval): ResourceState<StatsOut> {
  return useResource(analysisApi().stats, statsKey(tf, zoneTf));
}

export function useSetupDetail(
  tf: CandleInterval,
  zoneTf: CandleInterval,
  setup: { pattern: string; direction: string; location: string } | null,
): ResourceState<SetupDetailOut> {
  return useResource(
    analysisApi().setup,
    setup ? setupDetailKey(tf, zoneTf, setup.pattern, setup.direction, setup.location) : null,
  );
}

export function useScanner(
  tf: CandleInterval,
  zoneTf: CandleInterval,
  symbols: readonly string[],
): ResourceState<ScannerOut> {
  return useResource(analysisApi().scanner, scannerKey(tf, zoneTf, symbols));
}
