import React from 'react';
import styles from './FundingPanel.module.scss';
import type { FundingOpportunity } from '../../types/marketData';

interface FundingPanelProps {
    opportunities: FundingOpportunity[];
}

const FundingPanel: React.FC<FundingPanelProps> = ({ opportunities }) => {
    return (
        <div className={styles.fundingPanel}>
            <h2>Funding Opportunities</h2>
            {opportunities.length === 0 ? (
                <div className={styles.noOpportunities}>No funding opportunities detected.</div>
            ) : (
                <table className={styles.table}>
                    <thead>
                        <tr>
                            <th>Symbol</th>
                            <th>Exchange</th>
                            <th>Funding Rate</th>
                            <th>Funding Interval</th>
                        </tr>
                    </thead>
                    <tbody>
                        {opportunities.map((opp, index) => (
                            <tr key={`${opp.symbol}-${index}`}>
                                <td className={styles.symbol}>{opp.symbol}</td>
                                <td className={styles.symbol}>{opp.exchange}</td>
                                <td className={styles.symbol}>{opp.fundingRate}</td>
                                <td className={styles.symbol}>{opp.fundingInterval}</td>

                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    );
};

export default FundingPanel;
