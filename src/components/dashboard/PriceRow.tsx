import React, { memo } from 'react';
import styles from './PriceTable.module.scss';

interface PriceRowProps {
  symbol: string;
  type: string;
  exchanges: string[];
  getPrice: (symbol: string, exchange: string, type: string) => number | null;
  removeSymbol: (symbol: string) => void;
}

const PriceRow: React.FC<PriceRowProps> = memo(({
  symbol,
  type,
  exchanges,
  getPrice,
  removeSymbol
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

export default PriceRow;
