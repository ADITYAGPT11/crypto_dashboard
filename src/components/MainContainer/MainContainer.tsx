import { useEffect, useState, useRef, useCallback, memo } from "react";
import { MarketDataService } from "../../services/MarketDataService";
import type { GenericMarketData, ArbitrageOpportunity } from "../../types/marketData";
import { FastMarketDataLookup } from "../../utils/fastLookup";
import { SymbolSearch } from "../SymbolSearch";
import ArbitragePanel from "../ArbitragePanel/ArbitragePanel";
import Header from "../dashboard/Header";
import Metrics from "../dashboard/Metrics";
import PriceTable from "../dashboard/PriceTable";
import FundingPanel from "../FundingPanel/FundingPanel";
import styles from "./MainContainer.module.scss";

interface DashboardProps {
  theme: string;
  toggleTheme: () => void;
}

const MainContainer: React.FC<DashboardProps> = ({ theme, toggleTheme }) => {
  const fastLookup = useRef(new FastMarketDataLookup());
  const marketDataService = useRef<MarketDataService | null>(null);

  const [tickers, setTickers] = useState<GenericMarketData[]>([]);
  const [exchanges, setExchanges] = useState<string[]>([]);
  const [types, setTypes] = useState<string[]>([]);
  const [symbolList, setSymbolList] = useState<string[]>(["BTC-USDT", "ETH-USDT"]);
  const [arbitrageOpportunities, setArbitrageOpportunities] = useState<ArbitrageOpportunity[]>([]);

  const ARBITRAGE_THRESHOLD_PERCENT = 0.1;

  const getPrice = useCallback(
    (symbol: string, exchange: string, type: string): number | null => {
      return fastLookup.current.getPrice(exchange, symbol, type);
    },
    []
  );

  const addSymbol = useCallback(
    (symbol: string) => {
      if (!symbolList.includes(symbol)) {
        setSymbolList(prev => [...prev, symbol]);
      }
    },
    [symbolList]
  );

  const removeSymbol = useCallback((symbol: string) => {
    setSymbolList(prev => prev.filter(s => s !== symbol));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (!marketDataService.current) {
      marketDataService.current = MarketDataService.getInstance();
    }

    const service = marketDataService.current;

    const handler = (msg: GenericMarketData) => {
      fastLookup.current.update(
        msg.exchange,
        msg.symbol,
        msg.type,
        msg.currentPrice,
        msg.timeStamp
      );

      const exchanges = fastLookup.current.getExchanges();

      if (exchanges.length === 2) {
        const price1 = fastLookup.current.getPrice(exchanges[0], msg.symbol, msg.type);
        const price2 = fastLookup.current.getPrice(exchanges[1], msg.symbol, msg.type);

        if (price1 && price2) {
          const spread = price1 - price2;
          const spreadPercent = (spread / price2) * 100;

          if (Math.abs(spreadPercent) > ARBITRAGE_THRESHOLD_PERCENT) {
            const newOpportunity: ArbitrageOpportunity = {
              symbol: msg.symbol,
              spread,
              spreadPercent,
              bestAsk: {
                exchange: price1 > price2 ? exchanges[1] : exchanges[0],
                price: Math.min(price1, price2),
              },
              bestBid: {
                exchange: price1 > price2 ? exchanges[0] : exchanges[1],
                price: Math.max(price1, price2),
              },
            };

            setArbitrageOpportunities(prev => {
              const idx = prev.findIndex(o => o.symbol === newOpportunity.symbol);
              if (idx !== -1) {
                const copy = [...prev];
                copy[idx] = newOpportunity;
                return copy;
              }
              return [...prev, newOpportunity];
            });
          }
        }
      }

      setTickers(fastLookup.current.getAllData());
      setExchanges(fastLookup.current.getExchanges());
      setTypes(fastLookup.current.getTypes());
    };

    service.on("marketData", handler);
    service.on("connected", data => console.log("Service connected:", data));
    service.on("error", error => console.error("Service error:", error));

    return () => {
      service.off("marketData", handler);
    };
  }, []);

  useEffect(() => {
    if (marketDataService.current && symbolList.length > 0) {
      const service = marketDataService.current;
      setTimeout(async () => {
        try {
          await service.startMarketData(symbolList);
        } catch (error) {
          console.error("Error subscribing to new symbols:", error);
        }
      }, 100);
    }
  }, [symbolList]);

  const hasData = exchanges.length > 0 && types.length > 0;

  return (
    <div className={`${styles.dashboard} ${styles[theme]}`}>
      <Header hasData={hasData} theme={theme} toggleTheme={toggleTheme} />

      <div className={styles.container}>
        <div className={styles.searchContainer}>
          <SymbolSearch onAddSymbol={addSymbol} currentSymbols={symbolList} />
        </div>

        <Metrics
          totalSymbols={symbolList.length}
          totalExchanges={exchanges.length}
          totalDataPoints={tickers.length}
        />

        <PriceTable
          symbols={symbolList}
          types={types}
          exchanges={[...exchanges].sort()}
          hasData={hasData}
          getPrice={getPrice}
          removeSymbol={removeSymbol}
        />

        <ArbitragePanel opportunities={arbitrageOpportunities} />
        <FundingPanel opportunities={[]} />
      </div>
    </div>
  );
};

export default memo(MainContainer);
