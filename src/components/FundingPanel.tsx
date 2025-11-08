import React from 'react';
import './FundingPanel.scss';
import type { FundingOpportunity } from '../types/marketData';

interface FundingPanelProps {
    opportunities: FundingOpportunity[];
}

const FundingPanel: React.FC<FundingPanelProps> = ({ opportunities }) => {
    return (
        <div className="funding-panel">
            <h2>Funding Opportunities</h2>
            {opportunities.length === 0 ? (
                <div className="no-opportunities">No funding opportunities detected.</div>
            ) : (
                <table className="table">
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
                                <td className="symbol">{opp.symbol}</td>
                                <td className="symbol">{opp.exchange}</td>
                                <td className="symbol">{opp.fundingRate}</td>
                                <td className="symbol">{opp.fundingInterval}</td>

                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    );
};

export default FundingPanel;
