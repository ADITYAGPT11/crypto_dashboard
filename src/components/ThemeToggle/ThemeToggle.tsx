import React, { useEffect, useState } from 'react';
import { Theme, THEME_CONFIG } from './constants';
import type { Theme as ThemeType } from './constants';
import styles from './ThemeToggle.module.scss';

const ThemeToggle: React.FC = () => {
  const [theme, setTheme] = useState<ThemeType>(Theme.Light);

  const toggleTheme = () => {
    setTheme(prev =>
      prev === Theme.Light ? Theme.Dark : Theme.Light
    );
  };

  const themeConfig = THEME_CONFIG[theme];

  useEffect(() => {
    document.documentElement.className = themeConfig.className;
  }, [themeConfig.className]);

  return (
    <button
      onClick={toggleTheme}
      className={`${styles.themeToggle} ${themeConfig.className}`}
    >
      <span className="icon">{themeConfig.icon}</span>
    </button>
  );
};

export default ThemeToggle;
