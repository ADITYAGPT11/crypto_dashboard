import { useEffect, useState, useRef } from "react";
import {
  type Candle,
  type CandleInterval,
  type ExchangeName,
  type MarketType,
  CANDLE_INTERVALS,
} from "../../types/marketData";
import { CandleService } from "../../services/CandleService";
import styles from "./ChartPanel.module.scss";

type ChartProps = {
  symbol: string;
  intervals: CandleInterval[];
  setInterval: (interval: CandleInterval) => void;
};

const ChartPanel: React.FC<ChartProps> = ({ symbol, intervals, setInterval }: ChartProps) => {
  const _intervals = intervals ?? CANDLE_INTERVALS;
  const [selectedInterval, setSelectedInterval] = useState<CandleInterval>(intervals[0]);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const loadCandles = useRef<(interval: CandleInterval) => Promise<void>>(null);
  loadCandles.current = async (interval: CandleInterval) => {
    setIsLoading(true);
    try {
      const data = await CandleService.fetchCandles({
        symbol,
        exchange: "BINANCE" as ExchangeName,
        type: "SPOT" as MarketType,
        interval,
      });
      setCandles(data as Candle[]);
    } catch (error) {
      console.error("Error loading candles:", error);
    } finally {
      setIsLoading(false);
    }
  };
  useEffect(() => {
    void loadCandles.current?.(selectedInterval);
  }, [selectedInterval]);

  const handleIntervalChange = (interval: CandleInterval) => {
    setSelectedInterval(interval);
    setInterval(interval);
  };

  return (
    <div className={styles.panel}>
      <div className={styles.controls}>
        <select
          value={selectedInterval}
          onChange={(e) => handleIntervalChange(e.target.value as CandleInterval)}
        >
          {intervals.map((interval) => (
            <option key={interval} value={interval}>
              {interval}
            </option>
          ))}
        </select>
      </div>
      {isLoading && <div>Loading chart...</div>}
      {!isLoading && candles.length > 0 && (
        <div
          style={{
            position: "relative",
            height: "400px",
            width: "100%",
          }}
        >
          <p>
            Chart placeholder for {symbol} - {selectedInterval}
          </p>
        </div>
      )}
    </div>
  );
};

export default ChartPanel;
