import React from 'react';
import './ArbitragePanel.scss';
import type { ArbitrageOpportunity } from '../types/marketData';

interface ArbitragePanelProps {
  opportunities: ArbitrageOpportunity[];
}

const ArbitragePanel: React.FC<ArbitragePanelProps> = ({ opportunities }) => {
  return (
    <div className="arbitrage-panel">
      <h2>Arbitrage Opportunities</h2>
      {opportunities.length === 0 ? (
        <div className="no-opportunities">No arbitrage opportunities detected.</div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Spread (%)</th>
              <th>Best Ask (Buy At)</th>
              <th>Best Bid (Sell At)</th>
            </tr>
          </thead>
          <tbody>
            {opportunities.map((opp, index) => (
              <tr key={`${opp.symbol}-${index}`}>
                <td className="symbol">{opp.symbol}</td>
                <td className={`spread-percent ${opp.spreadPercent > 0 ? 'positive' : 'negative'}`}>
                  {opp.spreadPercent.toFixed(3)}%
                </td>
                <td className="exchange-info">
                  <span className="exchange-name">{opp.bestAsk.exchange}: </span>
                  <span className="price">${opp.bestAsk.price.toFixed(2)}</span>
                </td>
                <td className="exchange-info">
                  <span className="exchange-name">{opp.bestBid.exchange}: </span>
                  <span className="price">${opp.bestBid.price.toFixed(2)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

export default ArbitragePanel;
