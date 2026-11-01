import React, { useEffect, useState } from "react";
import { Theme, THEME_CONFIG } from "./constants";
import type { Theme as ThemeType } from "./constants";
import styles from "./ThemeToggle.module.scss";

const THEME_STORAGE_KEY = "ui:theme";

/** Dark is the default; a stored "light" preference wins when present. */
function initialTheme(): ThemeType {
  try {
    if (localStorage.getItem(THEME_STORAGE_KEY) === Theme.Light) return Theme.Light;
  } catch {
    // storage unavailable (private mode) → default
  }
  return Theme.Dark;
}

const ThemeToggle: React.FC = () => {
  const [theme, setTheme] = useState<ThemeType>(initialTheme);

  const toggleTheme = () => {
    setTheme((prev) => (prev === Theme.Light ? Theme.Dark : Theme.Light));
  };

  const themeConfig = THEME_CONFIG[theme];

  useEffect(() => {
    document.documentElement.className = themeConfig.className;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // persistence failure must never break the UI
    }
  }, [theme, themeConfig.className]);

  return (
    <button
      onClick={toggleTheme}
      className={`${styles.bToggle} ${themeConfig.className}`}
      aria-label={`Switch to ${theme === Theme.Light ? "dark" : "light"} theme`}
    >
      <span className="icon">{themeConfig.icon}</span>
    </button>
  );
};

export default ThemeToggle;
