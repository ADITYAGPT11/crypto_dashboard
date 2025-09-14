import React from 'react';
import { RealTimeClock } from '../RealTimeClock';
import styles from './Header.module.scss';

interface HeaderProps {
  hasData: boolean;
  totalDataPoints: number;
  totalExchanges: number;
}

const Header: React.FC<HeaderProps> = ({ hasData, totalDataPoints, totalExchanges }) => {
  return (
    <div className={styles.header}>
      <div className={styles.headerContent}>
        <h1 className={styles.title}>Multi Exchange Dashboard</h1>
        <div className={styles.statusBar}>
          <div className={styles.statusItem}>
            <div className={`${styles.statusIndicator} ${hasData ? '' : styles.disconnected}`}></div>
            <span>{hasData ? 'Live' : 'Connecting...'}</span>
          </div>
          <div className={styles.statusItem}>
            <span>{totalDataPoints} Data Points</span>
          </div>
          <div className={styles.statusItem}>
            <span>{totalExchanges} Exchanges</span>
          </div>
          <RealTimeClock />
        </div>
      </div>
    </div>
  );
};

export default Header;
