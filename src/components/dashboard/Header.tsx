import React from 'react';
import ThemeToggleButton from '../ThemeToggle/ThemeToggleButton';
import './Header.scss';
import RealTimeClock from '../../common-components/RealTimeClock';

interface HeaderProps {
  hasData: boolean;
  theme: string;
  toggleTheme: () => void;
}

const Header: React.FC<HeaderProps> = ({ hasData, theme, toggleTheme }) => {
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
          <ThemeToggleButton theme={theme} toggleTheme={toggleTheme} />
        </div>
      </div>
    </div>
  );
};

export default Header;
