import { useEffect, useState } from "react";
import { CandleService } from "../services/CandleService";
import { MarketDataService } from "../services/MarketDataService";
import type { Candle, CandleInterval } from "../types/marketData";
import { pickLive, type LiveSource } from "../utils/liveCandle";

export interface LiveCandle {
  candle: Candle | null;
  /** Exchange the forming candle comes from, or null while nothing has arrived. */
  source: LiveSource | null;
  /** Time of the last tick (ms), for the "live" indicator. */
  at: number | null;
}

const NONE: LiveCandle = { candle: null, source: null, at: null };

/**
 * The forming candle of the perpetual, from Binance's kline stream, or OKX's when
 * Binance has been silent for a while (blocked network, outage). Drawn on the chart
 * only; analysis keeps using closed candles.
 */
export function useLiveCandle(symbol: string, interval: CandleInterval): LiveCandle {
  const [state, setState] = useState<{ key: string; live: LiveCandle }>({ key: "", live: NONE });
  const key = `${symbol}|${interval}`;
  useEffect(() => {
    // Connecting the exchanges wires the candle streams (idempotent).
    MarketDataService.getInstance().startMarketData(symbol);
    const svc = CandleService.getInstance();
    const last: Record<LiveSource, { candle: Candle; at: number } | null> = {
      BINANCE: null,
      OKX: null,
    };
    const update = () => {
      const live = pickLive(last, Date.now());
      if (live) setState({ key, live });
    };
    const offB = svc.subscribe("BINANCE", "FUT", symbol, interval, (d) => {
      last.BINANCE = { candle: d.candle, at: Date.now() };
      update();
    });
    const offO = svc.subscribe("OKX", "FUT", symbol, interval, (d) => {
      last.OKX = { candle: d.candle, at: Date.now() };
      update();
    });
    const timer = setInterval(update, 5_000); // re-evaluate staleness without ticks
    return () => {
      offB();
      offO();
      clearInterval(timer);
    };
  }, [key, symbol, interval]);
  return state.key === key ? state.live : NONE;
}
