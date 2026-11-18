import { useEffect, useState } from "react";
import { MarketDataService } from "../services/MarketDataService";
import { TradeService } from "../services/TradeService";
import type { TradeEvent } from "../types/marketData";
import { FootprintBook, type FootprintBar } from "../utils/footprint";

export interface Footprint {
  bars: FootprintBar[];
  step: number;
  /** Trades seen since the page opened (what the footprint is built from). */
  trades: number;
}

const NONE: Footprint = { bars: [], step: 1, trades: 0 };
const PUBLISH_MS = 1_000;
/** Raw trades kept so a timeframe or row-size change can rebuild the footprint. */
const MAX_RAW = 300_000;

/** Trades since the page opened, shared by every footprint of the session (per symbol). */
const raw = new Map<string, TradeEvent[]>();

/**
 * Live footprint of the Binance perpetual for one view interval and row size (`symbol` null =
 * off). Built from the aggTrade stream outside React; the component sees one update a second.
 */
export function useFootprint(symbol: string | null, intervalMs: number, step: number): Footprint {
  const [state, setState] = useState<{ key: string; value: Footprint }>({ key: "", value: NONE });
  const key = `${symbol}|${intervalMs}|${step}`;
  useEffect(() => {
    if (!symbol) return;
    MarketDataService.getInstance().startMarketData(symbol); // idempotent; wires aggTrade
    const trades = TradeService.getInstance();
    let buf = raw.get(symbol);
    if (!buf) {
      buf = [...trades.getTrades("BINANCE", "FUT", symbol)];
      raw.set(symbol, buf);
    }
    const kept = buf;
    const book = new FootprintBook(intervalMs, step);
    for (const t of kept) book.add(t);
    let dirty = true;
    const off = trades.subscribe("BINANCE", "FUT", symbol, (t) => {
      kept.push(t);
      if (kept.length > MAX_RAW) kept.splice(0, kept.length - MAX_RAW);
      book.add(t);
      dirty = true;
    });
    const publish = () => {
      if (!dirty) return;
      dirty = false;
      setState({ key, value: { bars: book.snapshot(), step, trades: kept.length } });
    };
    publish();
    const timer = setInterval(publish, PUBLISH_MS);
    return () => {
      off();
      clearInterval(timer);
    };
  }, [key, symbol, intervalMs, step]);
  return symbol !== null && state.key === key ? state.value : NONE;
}
