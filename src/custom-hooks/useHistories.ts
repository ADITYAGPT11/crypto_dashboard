import { useEffect, useMemo, useState } from "react";
import { HistoryService } from "../services/HistoryService";
import type { Candle, CandleInterval } from "../types/marketData";

export interface TfHistory {
  candles: Candle[];
  loading: boolean;
  error: string | null;
}

const EMPTY: Candle[] = [];
const LOADING: TfHistory = { candles: EMPTY, loading: true, error: null };

/** Closed-candle history for one symbol on several timeframes at once. */
export function useHistories(
  symbol: string,
  tfs: readonly CandleInterval[],
  attempt = 0,
): Map<CandleInterval, TfHistory> {
  const key = `${symbol}|${[...tfs].sort().join(",")}|${attempt}`;
  const [loaded, setLoaded] = useState<{ key: string; byTf: Map<CandleInterval, TfHistory> }>({
    key: "",
    byTf: new Map(),
  });

  useEffect(() => {
    let cancelled = false;
    const list = key.split("|")[1].split(",").filter(Boolean) as CandleInterval[];
    const svc = HistoryService.getInstance();
    for (const tf of list) {
      void svc
        .load(symbol, tf)
        .then((h) => ({ candles: h.candles, loading: false, error: null }))
        .catch((err: unknown) => ({
          candles: EMPTY,
          loading: false,
          error: err instanceof Error ? err.message : String(err),
        }))
        .then((state: TfHistory) => {
          if (cancelled) return;
          setLoaded((prev) => {
            const byTf = new Map(prev.key === key ? prev.byTf : []);
            byTf.set(tf, state);
            return { key, byTf };
          });
        });
    }
    return () => {
      cancelled = true;
    };
  }, [key, symbol]);

  // Stable between renders until a timeframe finishes loading.
  return useMemo(() => {
    const out = new Map<CandleInterval, TfHistory>();
    for (const tf of tfs) out.set(tf, (loaded.key === key && loaded.byTf.get(tf)) || LOADING);
    return out;
  }, [loaded, key, tfs]);
}
