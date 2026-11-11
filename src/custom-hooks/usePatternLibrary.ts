import { useCallback, useEffect, useState } from "react";
import { PatternLibraryService, type LibraryEntry } from "../services/PatternLibraryService";
import type { CandleInterval } from "../types/marketData";
import type { LibraryKind } from "../types/patternLibrary";

const REFRESH_MS = 60_000; // re-check each minute; the service refetches only after a close

/** Backend patterns + stats for one symbol × timeframe × kind, and a retry function. */
export function usePatternLibrary(
  symbol: string,
  interval: CandleInterval,
  kind: LibraryKind,
): { entry: LibraryEntry | null; retry: () => void } {
  const service = PatternLibraryService.getInstance();
  const [, bump] = useState(0);

  useEffect(() => service.subscribe(() => bump((x) => x + 1)), [service]);

  useEffect(() => {
    void service.load(symbol, interval, kind);
    const id = setInterval(() => void service.load(symbol, interval, kind), REFRESH_MS);
    return () => clearInterval(id);
  }, [service, symbol, interval, kind]);

  const retry = useCallback(
    () => void service.load(symbol, interval, kind, true),
    [service, symbol, interval, kind],
  );

  return { entry: service.get(symbol, interval, kind), retry };
}
