import { useEffect, useState } from 'react';
import './App.scss';
import Dashboard from './components/MainContainer/MainContainer';

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
      <Dashboard theme={theme} toggleTheme={toggleTheme} />
    </div>
  );
}

export default App;
