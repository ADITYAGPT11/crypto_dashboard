import React from 'react';
import styles from './ArbitragePanel.module.scss';
import type { ArbitrageOpportunity } from '../types/marketData';

interface ArbitragePanelProps {
  opportunities: ArbitrageOpportunity[];
}

const ArbitragePanel: React.FC<ArbitragePanelProps> = ({ opportunities }) => {
  if (opportunities.length === 0) {
    return null; // Don't render if no opportunities
  }

  return (
    <div className={styles.arbitragePanel}>
      <h2>Arbitrage Opportunities</h2>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Spread</th>
            <th>Best Ask (Buy At)</th>
            <th>Best Bid (Sell At)</th>
          </tr>
        </thead>
        <tbody>
          {opportunities.map((opp, index) => (
            <tr key={index}>
              <td>{opp.symbol}</td>
              <td className={opp.spreadPercent > 0 ? styles.positive : styles.negative}>
                {opp.spread.toFixed(2)} ({opp.spreadPercent.toFixed(3)}%)
              </td>
              <td>{opp.bestAsk.exchange} - ${opp.bestAsk.price.toFixed(2)}</td>
              <td>{opp.bestBid.exchange} - ${opp.bestBid.price.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default ArbitragePanel;
