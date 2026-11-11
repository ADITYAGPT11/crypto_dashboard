import { useEffect, useState } from "react";
import { HistoryService, RESEARCH_UNIVERSE } from "../services/HistoryService";
import { loadWatchlist } from "../utils/watchlistStorage";
import type { Candle, CandleInterval } from "../types/marketData";

export interface UniverseCandles {
  loading: boolean;
  candles: Map<string, Candle[]>;
  failed: string[];
}

const NO_CANDLES = new Map<string, Candle[]>();

/**
 * Closed-candle history for several coins (sparklines, market overview). Analysis
 * and statistics come from the backend; this is display data only.
 */
export function useUniverseCandles(
  symbols: string[],
  interval: CandleInterval,
  attempt = 0,
): UniverseCandles {
  const key = `${symbols.join(",")}|${interval}|${attempt}`;
  const [loaded, setLoaded] = useState<{
    key: string;
    candles: Map<string, Candle[]>;
    failed: string[];
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const list = key.split("|")[0].split(",").filter(Boolean);
    const svc = HistoryService.getInstance();
    void Promise.allSettled(list.map((s) => svc.load(s, interval))).then((results) => {
      if (cancelled) return;
      const candles = new Map<string, Candle[]>();
      const failed: string[] = [];
      results.forEach((r, i) => {
        if (r.status === "fulfilled" && r.value.candles.length > 0)
          candles.set(list[i], r.value.candles);
        else failed.push(list[i]);
      });
      setLoaded({ key, candles, failed });
    });
    return () => {
      cancelled = true;
    };
  }, [key, interval]);

  return {
    loading: loaded?.key !== key,
    candles: loaded?.candles ?? NO_CANDLES,
    failed: loaded?.key === key ? loaded.failed : [],
  };
}

/** The coins shown with the research universe: the watchlist plus the universe. */
export function researchUniverse(): string[] {
  return [...new Set([...loadWatchlist(), ...RESEARCH_UNIVERSE])];
}
