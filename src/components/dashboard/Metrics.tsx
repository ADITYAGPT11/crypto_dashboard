import React from 'react';
import styles from './Metrics.module.scss';

interface MetricsProps {
  totalSymbols: number;
  totalExchanges: number;
  totalDataPoints: number;
}

const Metrics: React.FC<MetricsProps> = ({ totalSymbols, totalExchanges, totalDataPoints }) => {
  return (
    <div className={styles.metrics}>
      <div className={styles.metricCard}>
        <div className={styles.metricValue}>{totalSymbols}</div>
        <div className={styles.metricLabel}>Symbols</div>
      </div>
      <div className={styles.metricCard}>
        <div className={styles.metricValue}>{totalExchanges}</div>
        <div className={styles.metricLabel}>Exchanges</div>
      </div>
      <div className={styles.metricCard}>
        <div className={styles.metricValue}>{totalDataPoints}</div>
        <div className={styles.metricLabel}>Live Data</div>
      </div>
    </div>
  );
};

export default Metrics;
