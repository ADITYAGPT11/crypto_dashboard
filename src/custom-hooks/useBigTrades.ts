import { useEffect, useState } from "react";
import { MarketDataService } from "../services/MarketDataService";
import { TradeService } from "../services/TradeService";
import { BigTradeDetector, type BigTrade } from "../utils/orderFlow";

export interface BigTrades {
  /** Big taker orders since the chart opened, oldest first. */
  prints: BigTrade[];
  /** Notional (USDT) a print needs to count as big, or null while warming up. */
  threshold: number | null;
}

const NONE: BigTrades = { prints: [], threshold: null };
const MAX_PRINTS = 500;
const PUBLISH_MS = 500;
/** A taker order still being merged is closed after this much silence. */
const QUIET_MS = 1_000;

/**
 * Big taker orders on the Binance perpetual (aggTrade stream), for the chart's bubbles.
 * `symbol` null = off. Trades are merged and classified outside React; the component sees
 * at most two updates a second.
 */
export function useBigTrades(symbol: string | null): BigTrades {
  const [state, setState] = useState<{ symbol: string | null; value: BigTrades }>({
    symbol: null,
    value: NONE,
  });
  useEffect(() => {
    if (!symbol) return;
    MarketDataService.getInstance().startMarketData(symbol); // idempotent; wires aggTrade
    const trades = TradeService.getInstance();
    const detector = new BigTradeDetector();
    const prints: BigTrade[] = [];
    let dirty = true;
    let lastAt = 0;
    let lastThreshold: number | null = null;
    const add = (b: BigTrade | null) => {
      if (!b) return;
      prints.push(b);
      if (prints.length > MAX_PRINTS) prints.splice(0, prints.length - MAX_PRINTS);
      dirty = true;
    };
    // The service's recent buffer warms the threshold up faster.
    for (const t of trades.getTrades("BINANCE", "FUT", symbol)) add(detector.push(t));
    const off = trades.subscribe("BINANCE", "FUT", symbol, (t) => {
      lastAt = Date.now();
      add(detector.push(t));
    });
    const publish = () => {
      if (lastAt > 0 && Date.now() - lastAt > QUIET_MS) add(detector.flush());
      if (!dirty && detector.threshold === lastThreshold) return;
      dirty = false;
      lastThreshold = detector.threshold;
      setState({ symbol, value: { prints: [...prints], threshold: detector.threshold } });
    };
    publish();
    const timer = setInterval(publish, PUBLISH_MS);
    return () => {
      off();
      clearInterval(timer);
    };
  }, [symbol]);
  return symbol !== null && state.symbol === symbol ? state.value : NONE;
}
