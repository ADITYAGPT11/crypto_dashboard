import { useEffect, useState } from "react";
import { CandleService } from "../services/CandleService";
import { MarketDataService } from "../services/MarketDataService";
import type { Candle, CandleInterval } from "../types/marketData";

/**
 * The live (forming) candle of a Binance perpetual from the kline stream.
 * Drawn on the chart only; analysis keeps using closed candles.
 */
export function useLiveCandle(symbol: string, interval: CandleInterval): Candle | null {
  const [live, setLive] = useState<{ key: string; candle: Candle } | null>(null);
  const key = `${symbol}|${interval}`;
  useEffect(() => {
    // Connecting the exchanges wires the candle stream (idempotent).
    MarketDataService.getInstance().startMarketData(symbol);
    return CandleService.getInstance().subscribe("BINANCE", "FUT", symbol, interval, (d) =>
      setLive({ key, candle: d.candle }),
    );
  }, [key, symbol, interval]);
  return live?.key === key ? live.candle : null;
}
