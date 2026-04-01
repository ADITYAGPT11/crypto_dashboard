import React, { useState, useEffect, useCallback } from 'react';
import styles from './OptionScanner.module.scss';
import { angleOneService } from '../../services/AngleOneService';
import type { OptionChainData } from '../../types/optionData';

const AVAILABLE_SYMBOLS = [
  { value: 'NIFTY', label: 'NIFTY' },
  { value: 'BANKNIFTY', label: 'BANKNIFTY' },
  { value: 'FINNIFTY', label: 'FINNIFTY' },
];

const OptionScanner: React.FC = () => {
  const [selectedSymbol, setSelectedSymbol] = useState<string>('NIFTY');
  const [optionChain, setOptionChain] = useState<OptionChainData | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<string>('');
  const [connecting, setConnecting] = useState<boolean>(false);

  const fetchOptionChain = useCallback(async () => {
    setLoading(true);
    setError(null);
    
    try {
      const data = await angleOneService.getOptionChain(selectedSymbol);
      if (data) {
        setOptionChain(data);
        setLastUpdate(new Date().toLocaleTimeString());
      } else {
        setError('No option chain data available');
      }
    } catch (err) {
      setError('Failed to fetch option chain. Please try again.');
      console.error('Option chain fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedSymbol]);

  useEffect(() => {
    // Option chain data doesn't require login - fetch directly
    fetchOptionChain();
  }, []);

  useEffect(() => {
    fetchOptionChain();
  }, [fetchOptionChain]);

  useEffect(() => {
    const interval = setInterval(() => {
      fetchOptionChain();
    }, 30000);

    return () => clearInterval(interval);
  }, [fetchOptionChain]);

  const formatPrice = (price: number): string => {
    return price.toFixed(2);
  };

  const getATMStrike = (): number | null => {
    if (!optionChain) return null;
    const strikes = optionChain.strikes.map(s => s.strike);
    const closest = strikes.reduce((prev, curr) => {
      return Math.abs(curr - optionChain.underlyingPrice) < 
             Math.abs(prev - optionChain.underlyingPrice) ? curr : prev;
    });
    return closest;
  };

  const renderTShapedChain = () => {
    if (!optionChain) return null;

    const atmStrike = getATMStrike();
    const strikes = optionChain.strikes;
    
    const atmIndex = strikes.findIndex(s => s.strike === atmStrike);
    const startIndex = Math.max(0, atmIndex - 8);
    const endIndex = Math.min(strikes.length, atmIndex + 9);
    const visibleStrikes = strikes.slice(startIndex, endIndex);

    return (
      <div className={styles.tableWrapper}>
        <table className={styles.optionChainTable}>
          <thead>
            <tr className={styles.headerRow}>
              <th colSpan={6} className={styles.callsHeader}>CALLS</th>
              <th className={styles.strikeHeader}>STRIKE</th>
              <th colSpan={6} className={styles.putsHeader}>PUTS</th>
            </tr>
            <tr className={styles.subHeaderRow}>
              <th>IV</th>
              <th>Delta</th>
              <th>Gamma</th>
              <th>Theta</th>
              <th>Vega</th>
              <th>OI</th>
              <th className={styles.strikeCol}>{atmStrike}</th>
              <th>OI</th>
              <th>IV</th>
              <th>Delta</th>
              <th>Gamma</th>
              <th>Theta</th>
            </tr>
          </thead>
          <tbody>
            {visibleStrikes.map((strike) => {
              const isATM = strike.strike === atmStrike;
              const isITM = strike.strike < atmStrike!;
              const isOTM = strike.strike > atmStrike!;
              
              return (
                <tr 
                  key={strike.strike}
                  className={`
                    ${styles.strikeRow}
                    ${isATM ? styles.atmRow : ''}
                    ${isITM ? styles.itmRow : ''}
                    ${isOTM ? styles.otmRow : ''}
                  `}
                >
                  {strike.call ? (
                    <>
                      <td className={styles.greekCell}>
                        {strike.call.iv > 0 ? `${(strike.call.iv * 100).toFixed(1)}%` : '-'}
                      </td>
                      <td className={styles.greekCell}>{strike.call.delta.toFixed(2)}</td>
                      <td className={styles.greekCell}>{strike.call.gamma.toFixed(4)}</td>
                      <td className={styles.greekCell}>{strike.call.theta.toFixed(2)}</td>
                      <td className={styles.greekCell}>{strike.call.vega.toFixed(2)}</td>
                      <td className={styles.greekCell}>{strike.call.openInterest.toLocaleString()}</td>
                    </>
                  ) : (
                    <>
                      <td className={styles.greekCell}>-</td>
                      <td className={styles.greekCell}>-</td>
                      <td className={styles.greekCell}>-</td>
                      <td className={styles.greekCell}>-</td>
                      <td className={styles.greekCell}>-</td>
                      <td className={styles.greekCell}>-</td>
                    </>
                  )}
                  
                  <td className={`${styles.strikeCell} ${isATM ? styles.atmStrike : ''}`}>
                    {formatPrice(strike.strike)}
                  </td>
                  
                  {strike.put ? (
                    <>
                      <td className={styles.greekCell}>{strike.put.openInterest.toLocaleString()}</td>
                      <td className={styles.greekCell}>
                        {strike.put.iv > 0 ? `${(strike.put.iv * 100).toFixed(1)}%` : '-'}
                      </td>
                      <td className={styles.greekCell}>{strike.put.delta.toFixed(2)}</td>
                      <td className={styles.greekCell}>{strike.put.gamma.toFixed(4)}</td>
                      <td className={styles.greekCell}>{strike.put.theta.toFixed(2)}</td>
                      <td className={styles.greekCell}>{strike.put.vega.toFixed(2)}</td>
                    </>
                  ) : (
                    <>
                      <td className={styles.greekCell}>-</td>
                      <td className={styles.greekCell}>-</td>
                      <td className={styles.greekCell}>-</td>
                      <td className={styles.greekCell}>-</td>
                      <td className={styles.greekCell}>-</td>
                      <td className={styles.greekCell}>-</td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className={styles.optionScanner}>
      <div className={styles.header}>
        <h2>Option Scanner</h2>
        <div className={styles.controls}>
          <div className={styles.symbolSelector}>
            <label htmlFor="symbol-select">Symbol:</label>
            <select
              id="symbol-select"
              value={selectedSymbol}
              onChange={(e) => setSelectedSymbol(e.target.value)}
              className={styles.select}
            >
              {AVAILABLE_SYMBOLS.map((sym) => (
                <option key={sym.value} value={sym.value}>
                  {sym.label}
                </option>
              ))}
            </select>
          </div>
          <button 
            onClick={fetchOptionChain}
            disabled={loading}
            className={styles.refreshButton}
          >
            {loading ? 'Loading...' : 'Refresh'}
          </button>
          {lastUpdate && (
            <span className={styles.lastUpdate}>
              Last Update: {lastUpdate}
            </span>
          )}
        </div>
      </div>

      {error && (
        <div className={styles.errorMessage}>
          {error}
        </div>
      )}

      {!loading && !optionChain && (
        <div className={styles.noticeBanner}>
          <span>Option data is publicly accessible - no login required</span>
        </div>
      )}

      <div className={styles.chainContainer}>
        {loading ? (
          <div className={styles.loadingState}>
            <div className={styles.spinner}></div>
            <p>Loading option chain...</p>
          </div>
        ) : optionChain ? (
          <>
            <div className={styles.underlyingInfo}>
              <span className={styles.symbol}>{optionChain.symbol}</span>
              <span className={styles.price}>
                LTP: {formatPrice(optionChain.underlyingPrice)}
              </span>
              <span className={styles.expiry}>
                Expiry: {optionChain.expiryLabel}
              </span>
            </div>
            {renderTShapedChain()}
          </>
        ) : (
          <div className={styles.loadingState}>
            <p>Fetching option chain data...</p>
          </div>
        )}
      </div>

      {optionChain && (
        <div className={styles.legend}>
          <div className={styles.legendItem}>
            <span className={`${styles.legendColor} ${styles.atmLegend}`}></span>
            <span>ATM (At The Money)</span>
          </div>
          <div className={styles.legendItem}>
            <span className={`${styles.legendColor} ${styles.itmLegend}`}></span>
            <span>ITM (In The Money)</span>
          </div>
          <div className={styles.legendItem}>
            <span className={`${styles.legendColor} ${styles.otmLegend}`}></span>
            <span>OTM (Out The Money)</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default OptionScanner;