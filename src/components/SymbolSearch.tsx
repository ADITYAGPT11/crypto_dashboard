import { useState, useEffect, useRef } from 'react';
import { SymbolService } from '../services/SymbolService';
import styles from './Dashboard.module.scss';

interface SymbolSearchProps {
  onAddSymbol: (symbol: string) => void;
  currentSymbols: string[];
}

export const SymbolSearch = ({ onAddSymbol, currentSymbols }: SymbolSearchProps) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [allSymbols, setAllSymbols] = useState<string[]>([]);
  const searchRef = useRef<HTMLDivElement>(null);
  const symbolService = useRef<SymbolService | null>(null);

  useEffect(() => {
    // Initialize service on the client side
    if (!symbolService.current) {
        symbolService.current = SymbolService.getInstance();
    }

    const loadSymbols = async () => {
      if (!symbolService.current) return;
      setIsLoading(true);
      try {
        const symbols = await symbolService.current.fetchAllSymbols();
        setAllSymbols(symbols);
      } catch (error) {
        console.error('Error loading symbols:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadSymbols();
  }, []);

  // Filter suggestions based on search term
  useEffect(() => {
    if (!symbolService.current) return;
    if (searchTerm.length === 0) {
      // Show popular symbols when no search term
      const popularSymbols = symbolService.current.getPopularSymbols();
      setSuggestions(popularSymbols.filter(symbol => !currentSymbols.includes(symbol)));
    } else {
      // Search in all available symbols
      const filtered = symbolService.current.searchSymbols(searchTerm)
        .filter(symbol => !currentSymbols.includes(symbol));
      setSuggestions(filtered);
    }
  }, [searchTerm, currentSymbols, allSymbols]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSymbolSelect = (symbol: string) => {
    onAddSymbol(symbol);
    setSearchTerm('');
    setIsOpen(false);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
    setIsOpen(true);
  };

  const handleInputFocus = () => {
    setIsOpen(true);
  };

  return (
    <div className={styles.searchContainer} ref={searchRef}>
      <div className={styles.searchInputContainer}>
        <input
          type="text"
          placeholder="Search and add symbols..."
          value={searchTerm}
          onChange={handleInputChange}
          onFocus={handleInputFocus}
          className={styles.searchInput}
        />
        <div className={styles.searchIcon}>🔍</div>
      </div>
      
      {isOpen && (
        <div className={styles.suggestionsDropdown}>
          {isLoading ? (
            <div className={styles.loadingState}>
              <div className={styles.loadingSpinner}></div>
              Loading symbols...
            </div>
          ) : suggestions.length > 0 ? (
            <>
              <div className={styles.suggestionsHeader}>
                {searchTerm.length === 0 ? 'Popular Symbols' : 'Search Results'}
              </div>
              {suggestions.map((symbol) => (
                <div
                  key={symbol}
                  className={styles.suggestionItem}
                  onClick={() => handleSymbolSelect(symbol)}
                >
                  <div className={styles.symbolIcon}>
                    {symbol.charAt(0).toUpperCase()}
                  </div>
                  <span>{symbol}</span>
                  <div className={styles.addButton}>+</div>
                </div>
              ))}
            </>
          ) : searchTerm.length > 0 ? (
            <div className={styles.noResults}>
              No symbols found for "{searchTerm}"
            </div>
          ) : (
            <div className={styles.noResults}>
              No popular symbols available
            </div>
          )}
        </div>
      )}
    </div>
  );
};
