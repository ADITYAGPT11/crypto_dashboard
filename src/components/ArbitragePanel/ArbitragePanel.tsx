import React from "react";
import styles from "./ArbitragePanel.module.scss";
import type { ArbitrageOpportunity } from "../../types/marketData";

interface ArbitragePanelProps {
  opportunities: ArbitrageOpportunity[];
}

const ArbitragePanel: React.FC<ArbitragePanelProps> = ({ opportunities }) => {
  return (
    <div className={styles.arbitragePanel}>
      <h2>Arbitrage Opportunities</h2>
      {opportunities.length === 0 ? (
        <div className={styles.noOpportunities}>No arbitrage opportunities detected.</div>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Spread (%)</th>
              <th>Lowest Price (Reference)</th>
              <th>Highest Price (Reference)</th>
            </tr>
          </thead>
          <tbody>
            {opportunities.map((opp, index) => (
              <tr key={`${opp.symbol}-${index}`}>
                <td className={styles.symbol}>{opp.symbol}</td>
                <td
                  className={`${styles.spreadPercent} ${opp.spreadPercent > 0 ? styles.positive : styles.negative}`}
                >
                  {opp.spreadPercent.toFixed(3)}%
                </td>
                <td className={styles.exchangeInfo}>
                  <span className={styles.exchangeName}>{opp.lowest.exchange}: </span>
                  <span className={styles.price}>${opp.lowest.price.toFixed(2)}</span>
                </td>
                <td className={styles.exchangeInfo}>
                  <span className={styles.exchangeName}>{opp.highest.exchange}: </span>
                  <span className={styles.price}>${opp.highest.price.toFixed(2)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className={styles.disclaimer}>
        Spreads are indicative only — computed from last traded prices across exchanges, not
        executable bid/ask quotes.
      </p>
    </div>
  );
};

export default ArbitragePanel;
