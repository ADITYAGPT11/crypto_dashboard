import { useEffect, useState, useRef, useCallback, memo } from "react";
import { MarketDataService } from "../services/MarketDataService";
import type { GenericMarketData } from "../types/marketData";
import { FastMarketDataLookup } from "../utils/fastLookup";
import { RealTimeClock } from "./RealTimeClock";
import { SymbolSearch } from "./SymbolSearch";
import styles from "./Dashboard.module.scss";
import ArbitragePanel from "./ArbitragePanel";

// Memoized row component for ultra-fast rendering
const PriceRow = memo(({ 
  symbol, 
  type, 
  exchanges, 
  getPrice,
  removeSymbol
}: {
  symbol: string;
  type: string;
  exchanges: string[];
  getPrice: (symbol: string, exchange: string, type: string) => number | null;
  removeSymbol: (symbol: string) => void;
}) => {
  const prices = exchanges.map((ex) => getPrice(symbol, ex, type));
  const spread = exchanges.length === 2 && 
    prices[0] !== null && 
    prices[1] !== null
      ? (prices[0]! - prices[1]!)
      : null;

  const spreadPercent = spread && prices[0] && prices[1] 
    ? ((spread / prices[1]) * 100)
    : null;

  const getSymbolIcon = (symbol: string) => {
    return symbol.charAt(0).toUpperCase();
  };

  return (
    <tr>
      <td>
        <div className={styles.symbol}>
          <div className={styles.symbolIcon}>
            {getSymbolIcon(symbol)}
          </div>
          {symbol}
          <button 
            className={styles.removeButton}
            onClick={(e) => {
              e.stopPropagation();
              removeSymbol(symbol);
            }}
            title="Remove symbol"
          >
            ×
          </button>
        </div>
      </td>
      <td>
        <span className={styles.type}>{type}</span>
      </td>
      {prices.map((p, i) => (
        <td key={`${symbol}-${type}-${exchanges[i]}`}>
          <div>
            <div className={styles.price}>
              {p ? `$${p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "-"}
            </div>
            <div className={styles.exchange}>{exchanges[i]}</div>
          </div>
        </td>
      ))}
      {exchanges.length === 2 && (
        <td>
          {spread !== null ? (
            <div className={`${styles.spread} ${
              spread > 0 ? styles.positive : 
              spread < 0 ? styles.negative : 
              styles.neutral
            }`}>
              <div>
                {spread > 0 ? '+' : ''}${spread.toFixed(2)}
              </div>
              {spreadPercent && (
                <div style={{ fontSize: '12px', opacity: 0.8 }}>
                  {spreadPercent > 0 ? '+' : ''}{spreadPercent.toFixed(3)}%
                </div>
              )}
            </div>
          ) : (
            <div className={`${styles.spread} ${styles.neutral}`}>-</div>
          )}
        </td>
      )}
    </tr>
  );
});

interface ArbitrageOpportunity {
  symbol: string;
  spread: number;
  spreadPercent: number;
  bestAsk: { exchange: string; price: number };
  bestBid: { exchange: string; price: number };
}

function Dashboard() {
  const fastLookup = useRef(new FastMarketDataLookup());
  const [tickers, setTickers] = useState<GenericMarketData[]>([]);
  const [exchanges, setExchanges] = useState<string[]>([]);
  const [types, setTypes] = useState<string[]>([]);
  const [symbolList, setSymbolList] = useState<string[]>(["BTC-USDT", "ETH-USDT"]); // Dynamic symbol list
  const [arbitrageOpportunities, setArbitrageOpportunities] = useState<ArbitrageOpportunity[]>([]);
  const ARBITRAGE_THRESHOLD_PERCENT = 0.1; // Example threshold: 0.1%

  // Ultra-fast price lookup - O(1) complexity
  const getPrice = useCallback((
    symbol: string,
    exchange: string,
    type: string
  ): number | null => {
    return fastLookup.current.getPrice(exchange, symbol, type);
  }, []);

  // Add symbol function
  const addSymbol = useCallback((symbol: string) => {
    if (!symbolList.includes(symbol)) {
      setSymbolList(prev => [...prev, symbol]);
    }
  }, [symbolList]);

  // Remove symbol function
  const removeSymbol = useCallback((symbol: string) => {
    setSymbolList(prev => prev.filter(s => s !== symbol));
  }, []);

  // Initialize service once
  useEffect(() => {
    const service = MarketDataService.getInstance();
    
    // Add a small delay to ensure service is ready
    setTimeout(async () => {
      try {
        await service.startMarketData(symbolList);
      } catch (error) {
        console.error('Error starting service:', error);
      }
    }, 100);
  }, []); // Only run once on mount

  // Handle symbol list changes
  useEffect(() => {
    if (symbolList.length > 0) {
      const service = MarketDataService.getInstance();
      
      // Subscribe to new symbols
      setTimeout(async () => {
        try {
          await service.startMarketData(symbolList);
        } catch (error) {
          console.error('Error subscribing to new symbols:', error);
        }
      }, 100);
    }
  }, [symbolList]); // Run when symbolList changes

  // Set up data handler once
  useEffect(() => {
    const service = MarketDataService.getInstance();
    
    const handler = (msg: GenericMarketData) => {
      
      // Update fast lookup immediately - no delays
      fastLookup.current.update(
        msg.exchange,
        msg.symbol,
        msg.type,
        msg.currentPrice,
        msg.timeStamp
      );

      // --- START ARBITRAGE LOGIC ---
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
                      spread: spread,
                      spreadPercent: spreadPercent,
                      // Placeholder data until we have order books
                      bestAsk: { exchange: price1 > price2 ? exchanges[1] : exchanges[0], price: Math.min(price1, price2) },
                      bestBid: { exchange: price1 > price2 ? exchanges[0] : exchanges[1], price: Math.max(price1, price2) },
                  };

                  // Update state, avoiding duplicates
                  setArbitrageOpportunities(prev => {
                      const existingIndex = prev.findIndex(opp => opp.symbol === newOpportunity.symbol);
                      if (existingIndex !== -1) {
                          const updated = [...prev];
                          updated[existingIndex] = newOpportunity;
                          return updated;
                      } else {
                          return [...prev, newOpportunity];
                      }
                  });
              }
          }
      }
      // --- END ARBITRAGE LOGIC ---

      // Update UI immediately for real-time performance
      const allData = fastLookup.current.getAllData();
      const newExchanges = fastLookup.current.getExchanges();
      const newTypes = fastLookup.current.getTypes();
      
      setTickers(allData);
      setExchanges(newExchanges);
      setTypes(newTypes);
    };

    service.on("marketData", handler);
    
    // Also listen for connection events
    service.on("connected", (data) => {
      console.log('Service connected:', data);
    });
    
    service.on("error", (error) => {
      console.error('Service error:', error);
    });

    return () => {
      service.off("marketData", handler);
    };
  }, []); // Only set up handlers once


  // Calculate metrics
  const hasData = exchanges.length > 0 && types.length > 0;
  const totalSymbols = symbolList.length;
  const totalExchanges = exchanges.length;
  const totalDataPoints = tickers.length;

  // Always sort exchanges for consistent column order
  const sortedExchanges = [...exchanges].sort();
  
  return (
    <div className={styles.dashboard}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerContent}>
          <h1 className={styles.title}>Multi Exchange Dashboard</h1>
          <div className={styles.statusBar}>
            <div className={styles.statusItem}>
              <div className={`${styles.statusIndicator} ${hasData ? '' : 'disconnected'}`}></div>
              <span>{hasData ? 'Live' : 'Connecting...'}</span>
            </div>
            <div className={styles.statusItem}>
              <span>{totalDataPoints} Data Points</span>
            </div>
            <div className={styles.statusItem}>
              <span>{totalExchanges} Exchanges</span>
            </div>
            <RealTimeClock />
          </div>
        </div>
      </div>

      {/* Symbol Search */}
      <div style={{ margin: '24px', display: 'flex', justifyContent: 'center' }}>
        <SymbolSearch onAddSymbol={addSymbol} currentSymbols={symbolList} />
      </div>

      {/* Metrics */}
      <div className={styles.metrics}>
        <div className={styles.metricCard}>
          <div className={styles.metricValue}>{totalSymbols}</div>
          <div className={styles.metricLabel}>Symbols</div>
        </div>
        <div className={styles.metricCard}>
          <div className={styles.metricValue}>{totalExchanges}</div>
          <div className={styles.metricLabel}>Exchanges</div>
        </div>
        <div className={styles.metricCard}>
          <div className={styles.metricValue}>{totalDataPoints}</div>
          <div className={styles.metricLabel}>Live Data</div>
        </div>
      </div>
      
      {/* Main Table */}
      <div className={styles.tableContainer}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Asset</th>
              <th>Market</th>
              {sortedExchanges.length > 0 ? sortedExchanges.map((ex) => (
                <th key={ex}>{ex} Price</th>
              )) : (
                <>
                  <th>Binance Price</th>
                  <th>OKX Price</th>
                </>
              )}
              <th>Spread</th>
            </tr>
          </thead>
          <tbody>
            {hasData ? (
              symbolList.map((symbol) =>
                types.map((type) => (
                  <PriceRow
                    key={`${symbol}-${type}`}
                    symbol={symbol}
                    type={type}
                    exchanges={sortedExchanges}
                    getPrice={getPrice}
                    removeSymbol={removeSymbol}
                  />
                ))
              )
            ) : (
              // Show loading rows
              symbolList.map((symbol) =>
                ['SPOT', 'FUT'].map((type) => (
                  <tr key={`${symbol}-${type}`}>
                    <td>
                      <div className={styles.symbol}>
                        <div className={styles.symbolIcon}>
                          {symbol.charAt(0).toUpperCase()}
                        </div>
                        {symbol}
                      </div>
                    </td>
                    <td>
                      <span className={styles.type}>{type}</span>
                    </td>
                    <td>
                      <div>
                        <div className={styles.skeleton}></div>
                        <div className={styles.skeletonExchange}></div>
                      </div>
                    </td>
                    <td>
                      <div>
                        <div className={styles.skeleton}></div>
                        <div className={styles.skeletonExchange}></div>
                      </div>
                    </td>
                    <td>
                      <div className={styles.skeleton}></div>
                    </td>
                  </tr>
                ))
              )
            )}
          </tbody>
        </table>
      </div>
      <ArbitragePanel opportunities={arbitrageOpportunities} />
    </div>
  );
}

// Export memoized component for ultra-fast re-renders
export default memo(Dashboard);
