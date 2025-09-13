import { useEffect, useState, useRef } from "react";
import { MarketDataService } from "../services/MarketDataService";
import type { GenericMarketData } from "../types/marketData";
import styles from "./Dashboard.module.scss";

const symbolList = ["BTC", "ETH"]; // 🔹 fixed list

export default function Dashboard() {
  const tickerMap = useRef<Map<string, GenericMarketData>>(new Map());
  const [tickers, setTickers] = useState<GenericMarketData[]>([]);

  useEffect(() => {
    const service = new MarketDataService();
    service.startMarketData(symbolList); // subscribe only to BTC & ETH

    const handler = (msg: GenericMarketData) => {
      const key = `${msg.exchange}-${msg.symbol}-${msg.type}`;
      tickerMap.current.set(key, msg);
      setTickers(Array.from(tickerMap.current.values()));
    };

    service.on("marketData", handler);
    return () => {
      service.off("marketData", handler);
    };
  }, []);

  // 🔹 Extract exchanges & types dynamically
  const exchanges = Array.from(new Set(tickers.map((t) => t.exchange)));
  const types = Array.from(new Set(tickers.map((t) => t.type)));

  // 🔹 Helper: find price for given symbol-exchange-type
  const getPrice = (
    symbol: string,
    exchange: string,
    type: string
  ): number | null => {
    const t = tickers.find(
      (x) =>
        x.symbol.includes(symbol) && x.exchange === exchange && x.type === type
    );
    return t ? t.currentPrice : null;
  };

  return (
    <div className={styles.dashboard}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Type</th>
            {exchanges.map((ex) => (
              <th key={ex}>{ex}</th>
            ))}
            {exchanges.length === 2 && (
              <th>
                Spread ({exchanges[0]} - {exchanges[1]})
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {symbolList.map((symbol) =>
            types.map((type) => {
              const prices = exchanges.map((ex) => getPrice(symbol, ex, type));
              const spread =
                exchanges.length === 2 &&
                prices[0] !== null &&
                prices[1] !== null
                  ? (prices[0]! - prices[1]!).toFixed(2)
                  : null;

              return (
                <tr key={`${symbol}-${type}`}>
                  <td className={styles.symbol}>{symbol}</td>
                  <td className={styles.type}>{type}</td>
                  {prices.map((p, i) => (
                    <td key={`${symbol}-${type}-${exchanges[i]}`}>
                      {p ? p.toFixed(2) : "-"}
                    </td>
                  ))}
                  {exchanges.length === 2 && (
                    <td
                      className={
                        spread && parseFloat(spread) >= 0
                          ? styles.positive
                          : styles.negative
                      }
                    >
                      {spread ?? "-"}
                    </td>
                  )}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
