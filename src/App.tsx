import { useEffect, useState } from 'react';
import './App.scss';
import Dashboard from './components/Dashboard';
import { ErrorBoundary } from './components/ErrorBoundary';

function App() {
  const [theme, setTheme] = useState('light');

  const toggleTheme = () => {
    setTheme(theme === 'light' ? 'dark' : 'light');
  };

  useEffect(() => {
    document.documentElement.className = theme;
  }, [theme]);

  return (
    <div className="app">
      <ErrorBoundary>
        <Dashboard theme={theme} toggleTheme={toggleTheme} />
      </ErrorBoundary>
    </div>
  );
}

export default App;
