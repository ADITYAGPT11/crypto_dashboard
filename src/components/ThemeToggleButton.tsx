import React from 'react';
import './ThemeToggleButton.scss';

interface ThemeToggleButtonProps {
  theme: string;
  toggleTheme: () => void;
}

const ThemeToggleButton: React.FC<ThemeToggleButtonProps> = ({ theme, toggleTheme }) => {
  return (
    <button onClick={toggleTheme} className={`theme-toggle-button ${theme}`}>
      <span className="icon">{theme === 'light' ? '🌞' : '🌜'}</span>
    </button>
  );
};

export default ThemeToggleButton;
