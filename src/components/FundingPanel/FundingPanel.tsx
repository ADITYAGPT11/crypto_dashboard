import React from 'react';
import styles from './FundingPanel.module.scss';
import type { FundingOpportunity } from '../../types/marketData';

interface FundingPanelProps {
    opportunities: FundingOpportunity[];
}

function formatTime(ts: number | null): string {
  if (!ts) return "-";
  const remaining = ts - Date.now();
  if (remaining <= 0) return "Now";
  const hours = Math.floor(remaining / 3600000);
  const mins = Math.floor((remaining % 3600000) / 60000);
  return `${hours}h ${mins}m`;
}

const FundingPanel: React.FC<FundingPanelProps> = ({ opportunities }) => {
    return (
        <div className={styles.fundingPanel}>
            <h2>Funding Rates</h2>
            {opportunities.length === 0 ? (
                <div className={styles.noOpportunities}>No funding data available yet.</div>
            ) : (
                <table className={styles.table}>
                    <thead>
                        <tr>
                            <th>Symbol</th>
                            <th>Exchange</th>
                            <th>Price</th>
                            <th>Funding Rate</th>
                            <th>Interval</th>
                            <th>Next Funding</th>
                        </tr>
                    </thead>
                    <tbody>
                        {opportunities.map((opp, index) => (
                            <tr key={`${opp.symbol}-${opp.exchange}`}>
                                <td className={styles.symbol}>{opp.symbol}</td>
                                <td className={styles.exchange}>{opp.exchange}</td>
                                <td className={styles.price}>
                                    {opp.currentPrice != null
                                      ? `$${opp.currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                      : "-"}
                                </td>
                                <td className={`${styles.rate} ${opp.fundingRate >= 0 ? styles.positive : styles.negative}`}>
                                    {(opp.fundingRate * 100).toFixed(4)}%
                                </td>
                                <td className={styles.interval}>{opp.fundingInterval}</td>
                                <td className={styles.nextTime}>{formatTime(opp.nextFundingTime)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    );
};

export default FundingPanel;
