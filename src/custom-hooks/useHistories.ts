import { useEffect, useMemo, useState } from "react";
import { HistoryService, nextClose } from "../services/HistoryService";
import type { Candle, CandleInterval } from "../types/marketData";

export interface TfHistory {
  candles: Candle[];
  loading: boolean;
  error: string | null;
}

const EMPTY: Candle[] = [];
const LOADING: TfHistory = { candles: EMPTY, loading: true, error: null };

/**
 * Closed-candle history for one symbol on several timeframes at once. Reloaded just
 * after the next candle of any of these timeframes closes, so the chart follows the
 * market without a page reload; the previous candles stay on screen meanwhile.
 */
export function useHistories(
  symbol: string,
  tfs: readonly CandleInterval[],
  attempt = 0,
): Map<CandleInterval, TfHistory> {
  const tfKey = [...tfs].sort().join(",");
  const base = `${symbol}|${tfKey}|${attempt}`;
  const [closes, setCloses] = useState(0);
  const [loaded, setLoaded] = useState<{ base: string; byTf: Map<CandleInterval, TfHistory> }>({
    base: "",
    byTf: new Map(),
  });

  useEffect(() => {
    const list = tfKey.split(",").filter(Boolean) as CandleInterval[];
    if (list.length === 0) return;
    const now = Date.now();
    const due = Math.min(...list.map((tf) => nextClose(now, tf))) + 3_000;
    const timer = setTimeout(() => setCloses((c) => c + 1), Math.max(1_000, due - now));
    return () => clearTimeout(timer);
  }, [tfKey, closes]);

  useEffect(() => {
    let cancelled = false;
    const list = tfKey.split(",").filter(Boolean) as CandleInterval[];
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
            const byTf = new Map(prev.base === base ? prev.byTf : []);
            const old = byTf.get(tf);
            // A failed refresh keeps the candles we already have.
            byTf.set(tf, state.error && old?.candles.length ? old : state);
            return { base, byTf };
          });
        });
    }
    return () => {
      cancelled = true;
    };
  }, [base, tfKey, symbol, closes]);

  // Stable between renders until a timeframe finishes loading.
  return useMemo(() => {
    const out = new Map<CandleInterval, TfHistory>();
    for (const tf of tfs) out.set(tf, (loaded.base === base && loaded.byTf.get(tf)) || LOADING);
    return out;
  }, [loaded, base, tfs]);
}
