import { useEffect, useState } from "react";
import { CandleService } from "../services/CandleService";
import type {
  Candle,
  CandleData,
  CandleInterval,
  ExchangeName,
  MarketType,
} from "../types/marketData";

export interface CandleSource {
  exchange: ExchangeName;
  type: MarketType;
  symbol: string;
  interval: CandleInterval;
}

export interface UseCandlesResult {
  /** Ascending candles; empty while loading or on error. */
  candles: Candle[];
  /** True until the first data (or backfill error) arrives. */
  loading: boolean;
  /** Set when the history backfill fails (e.g. HTTP/network error). */
  error: Error | null;
}

/**
 * Live candle series for one (exchange, market, symbol, interval) tuple.
 * Mirrors the forceUpdate-on-notify pattern of the other hooks, but keeps a
 * copy of the service buffer in state so the chart can diff updates.
 */
export function useCandles(source: CandleSource): UseCandlesResult {
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const service = CandleService.getInstance();
    let cancelled = false;
    setLoading(true);
    setError(null);
    setCandles([]);

    const matches = (data: CandleData) =>
      data.exchange === source.exchange &&
      data.type === source.type &&
      data.symbol === source.symbol &&
      data.interval === source.interval;

    const onBackfillError = (e: Error) => {
      if (cancelled) return;
      setError(e);
      setLoading(false);
    };

    const onData = (data: CandleData) => {
      if (cancelled || !matches(data)) return;
      setCandles([
        ...service.getCandles(source.exchange, source.type, source.symbol, source.interval),
      ]);
      setLoading(false);
    };

    const unsubscribe = service.subscribe(
      source.exchange,
      source.type,
      source.symbol,
      source.interval,
      onData,
      onBackfillError,
    );

    // If a previous session already buffered this series, show it immediately.
    const existing = service.getCandles(
      source.exchange,
      source.type,
      source.symbol,
      source.interval,
    );
    if (existing.length > 0 && !cancelled) {
      setCandles([...existing]);
      setLoading(false);
    }

    return () => {
      cancelled = true;
      unsubscribe();
    };
    // source object identity is irrelevant; only fields matter
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source.exchange, source.type, source.symbol, source.interval]);

  return { candles, loading, error };
}
