import React from 'react';
import ThemeToggle from '../ThemeToggle/ThemeToggle';
import './Header.scss';
import RealTimeClock from '../../common-components/RealTimeClock';

interface HeaderProps {
  hasData: boolean;
}

const Header: React.FC<HeaderProps> = ({ hasData }) => {
  return (
    <div className="header">
      <div className="header-content">
        <h1 className="title">Multi Exchange Dashboard</h1>
        <div className="status-bar">
          <div className="status-item">
            <div className={`status-indicator ${hasData ? '' : 'disconnected'}`}></div>
            <span>{hasData ? 'Live' : 'Connecting...'}</span>
          </div>
          <RealTimeClock />
          <ThemeToggle />
        </div>
      </div>
    </div>
  );
};

export default Header;
