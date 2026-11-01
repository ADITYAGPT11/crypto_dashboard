import { useEffect, useState } from "react";
import { HistoryService } from "../services/HistoryService";
import type { Candle, CandleInterval } from "../types/marketData";

export interface HistoryState {
  candles: Candle[];
  loading: boolean;
  error: string | null;
}

interface Loaded {
  key: string;
  candles: Candle[];
  error: string | null;
}

const EMPTY: Candle[] = [];

/** Closed-candle history for one symbol (shared cache with the scanner). */
export function useHistory(symbol: string, interval: CandleInterval, attempt = 0): HistoryState {
  const key = `${symbol}|${interval}|${attempt}`;
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    let cancelled = false;
    HistoryService.getInstance()
      .load(symbol, interval)
      .then((h) => {
        if (!cancelled) setLoaded({ key, candles: h.candles, error: null });
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setLoaded({
            key,
            candles: EMPTY,
            error: err instanceof Error ? err.message : String(err),
          });
      });
    return () => {
      cancelled = true;
    };
  }, [key, symbol, interval]);

  // Data for an older request is never shown as current: loading is derived.
  const fresh = loaded?.key === key ? loaded : null;
  return { candles: fresh?.candles ?? EMPTY, loading: fresh === null, error: fresh?.error ?? null };
}
