import React, { memo } from 'react';
import styles from './PriceTable.module.scss';
import PriceRow from './PriceRow';

interface PriceTableProps {
  symbols: string[];
  types: string[];
  exchanges: string[];
  hasData: boolean;
  getPrice: (symbol: string, exchange: string, type: string) => number | null;
  removeSymbol: (symbol: string) => void;
}

const PriceTable: React.FC<PriceTableProps> = ({
  symbols,
  types,
  exchanges,
  hasData,
  getPrice,
  removeSymbol,
}) => {
  return (
    <div className={styles.tableContainer}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Asset</th>
            <th>Market</th>
            {exchanges.length > 0 ? exchanges.map((ex) => (
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
            symbols.map((symbol) =>
              types.map((type) => (
                <PriceRow
                  key={`${symbol}-${type}`}
                  symbol={symbol}
                  type={type}
                  exchanges={exchanges}
                  getPrice={getPrice}
                  removeSymbol={removeSymbol}
                />
              ))
            )
          ) : (
            // Show loading rows
            symbols.map((symbol) =>
              ['SPOT', 'FUT'].map((type) => ( // Using hardcoded types for skeleton
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
  );
};

export default memo(PriceTable);
