/**
 * The backend's analysis and scanner as shared, auto-refreshing resources (one singleton
 * set; `resetAnalysisApi()` in tests).
 *
 * - analysis: refetched just after each candle of its timeframe closes, so new
 *   patterns appear as live candles complete;
 * - scanner: after each candle close; catalogue: once.
 */
import type { AnalysisOut, CatalogOut, ScannerOut } from "../api/schema";
import { apiGet } from "../api/client";
import type { CandleInterval } from "../types/marketData";
import { setCatalog } from "../utils/patternLabels";
import { ApiResource } from "./ApiResource";
import { nextClose } from "./HistoryService";

/** Candles analysed for the chart (matches HistoryService's ~3000 preloaded candles). */
export const CHART_LIMIT = 3000;
const AFTER_CLOSE_MS = 4_000;

const untilNextClose = (tf: CandleInterval, now: number) =>
  nextClose(now, tf) - now + AFTER_CLOSE_MS;

export function analysisKey(symbol: string, tf: CandleInterval, zoneTf: CandleInterval) {
  return `${symbol}|${tf}|${zoneTf}`;
}
export function scannerKey(tf: CandleInterval, zoneTf: CandleInterval, symbols: readonly string[]) {
  return `${tf}|${zoneTf}|${symbols.join(",")}`;
}

function createResources() {
  return {
    catalog: new ApiResource<CatalogOut>({
      fetch: async () => {
        const c = await apiGet<CatalogOut>("/patterns");
        setCatalog(c);
        return c;
      },
    }),
    analysis: new ApiResource<AnalysisOut>({
      fetch: (key) => {
        const [symbol, tf, zoneTf] = key.split("|");
        return apiGet<AnalysisOut>(`/analysis/${symbol}`, { tf, zoneTf, limit: CHART_LIMIT });
      },
      refreshIn: (_d, key, now) => untilNextClose(key.split("|")[1] as CandleInterval, now),
    }),
    scanner: new ApiResource<ScannerOut>({
      fetch: (key) => {
        const [tf, zoneTf, symbols] = key.split("|");
        return apiGet<ScannerOut>("/scanner", { tf, zoneTf, symbols, bars: 3 });
      },
      refreshIn: (_d, key, now) => untilNextClose(key.split("|")[0] as CandleInterval, now),
    }),
  };
}

let resources: ReturnType<typeof createResources> | null = null;

export function analysisApi() {
  resources ??= createResources();
  return resources;
}

export function resetAnalysisApi() {
  resources = null;
  setCatalog(null);
}
