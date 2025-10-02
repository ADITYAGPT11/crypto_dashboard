import React from 'react';
import './Metrics.scss';

interface MetricsProps {
  totalSymbols: number;
  totalExchanges: number;
  totalDataPoints: number;
}

const Metrics: React.FC<MetricsProps> = ({ totalSymbols, totalExchanges, totalDataPoints }) => {
  return (
    <div className="metrics">
      <div className="metric-card">
        <div className="metric-value">{totalSymbols}</div>
        <div className="metric-label">Symbols</div>
      </div>
      <div className="metric-card">
        <div className="metric-value">{totalExchanges}</div>
        <div className="metric-label">Exchanges</div>
      </div>
      <div className="metric-card">
        <div className="metric-value">{totalDataPoints}</div>
        <div className="metric-label">Live Data</div>
      </div>
    </div>
  );
};

export default Metrics;
