import { useEffect, useState, useRef, useCallback, memo } from "react";
import { MarketDataService } from "../../services/MarketDataService";
import type { ArbitrageOpportunity } from "../../types/marketData";

import ArbitragePanel from "../ArbitragePanel/ArbitragePanel";
import Metrics from "../dashboard/Metrics";
import PriceTable from "../dashboard/PriceTable";
import FundingPanel from "../FundingPanel/FundingPanel";
import styles from "./MainContainer.module.scss";
import SymbolSearch from "../../common-components/SymbolSearch";

const EXCHANGES = ["Binance", "OKX"];
const TYPES = ["SPOT", "FUT"];

const MainContainer: React.FC = () => {
  const marketDataService = useRef<MarketDataService | null>(null);

  const [symbolList, setSymbolList] = useState<string[]>([
    "BTC-USDT",
    "ETH-USDT",
  ]);

  const [arbitrageOpportunities, setArbitrageOpportunities] = useState<
    ArbitrageOpportunity[]
  >([]);

  // const ARBITRAGE_THRESHOLD_PERCENT = 0.1;

  const addSymbol = useCallback((symbol: string) => {
    setSymbolList((prev) => (prev.includes(symbol) ? prev : [...prev, symbol]));
  }, []);

  const removeSymbol = useCallback((symbol: string) => {
    setSymbolList((prev) => prev.filter((s) => s !== symbol));
  }, []);

  useEffect(() => {
    if (!marketDataService.current) {
      marketDataService.current = MarketDataService.getInstance();
    }

    const service = marketDataService.current;

    const handler = (opportunity: ArbitrageOpportunity) => {
      setArbitrageOpportunities((prev) => {
        const idx = prev.findIndex((o) => o.symbol === opportunity.symbol);
        if (idx !== -1) {
          const copy = [...prev];
          copy[idx] = opportunity;
          return copy;
        }
        return [...prev, opportunity];
      });
    };

    service.on("arbitrage", handler);

    return () => {
      service.off("arbitrage", handler);
    };
  }, []);

  useEffect(() => {
    if (marketDataService.current && symbolList.length > 0) {
      marketDataService.current.startMarketData(symbolList);
    }
  }, [symbolList]);

  return (
    <div className={styles.dashboard}>
      <div className={styles.container}>
        <div className={styles.searchContainer}>
          <SymbolSearch onAddSymbol={addSymbol} currentSymbols={symbolList} />
        </div>

        <Metrics
          totalSymbols={symbolList.length}
          totalExchanges={EXCHANGES.length}
          totalDataPoints={symbolList.length * EXCHANGES.length * TYPES.length}
        />

        <PriceTable
          symbols={symbolList}
          types={TYPES}
          exchanges={EXCHANGES}
          hasData={true}
          removeSymbol={removeSymbol}
        />

        <ArbitragePanel opportunities={arbitrageOpportunities} />
        <FundingPanel opportunities={[]} />
      </div>
    </div>
  );
};

export default memo(MainContainer);
