import { useEffect, useState } from "react";
import { HistoryService, RESEARCH_UNIVERSE } from "../services/HistoryService";
import { loadWatchlist } from "../utils/watchlistStorage";
import type { Candle, CandleInterval } from "../types/marketData";
import { buildScan, type Scan } from "../utils/setupAnalysis";

export interface ScanState {
  loading: boolean;
  scan: Scan | null;
  candles: Map<string, Candle[]>;
  failed: string[];
}

interface Loaded {
  key: string;
  scan: Scan;
  candles: Map<string, Candle[]>;
  failed: string[];
}

const NO_CANDLES = new Map<string, Candle[]>();

/**
 * Load history for every symbol, then analyse and pool them. Symbols that fail
 * to load are listed in `failed`; the scan uses the rest. While a new request
 * runs, the previous result stays visible and `loading` is true.
 */
export function useScan(symbols: string[], interval: CandleInterval, attempt = 0): ScanState {
  const key = `${symbols.join(",")}|${interval}|${attempt}`;
  const [loaded, setLoaded] = useState<Loaded | null>(null);

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
      const scan = buildScan([...candles].map(([symbol, c]) => ({ symbol, candles: c })));
      setLoaded({ key, scan, candles, failed });
    });
    return () => {
      cancelled = true;
    };
  }, [key, interval]);

  return {
    loading: loaded?.key !== key,
    scan: loaded?.scan ?? null,
    candles: loaded?.candles ?? NO_CANDLES,
    failed: loaded?.key === key ? loaded.failed : [],
  };
}

/** The coins every setup is pooled across: the watchlist plus the research universe. */
export function researchUniverse(): string[] {
  return [...new Set([...loadWatchlist(), ...RESEARCH_UNIVERSE])];
}

/** `useScan` over the research universe (read once per mount). */
export function useResearchScan(interval: CandleInterval, attempt = 0, enabled = true) {
  const [universe] = useState(researchUniverse);
  return { universe, ...useScan(enabled ? universe : [], interval, attempt) };
}
