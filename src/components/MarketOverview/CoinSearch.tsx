import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { SymbolService } from "../../services/SymbolService";
import { MarketDataService } from "../../services/MarketDataService";
import { useLivePrice } from "../../custom-hooks/useLivePrice";
import { loadWatchlist, saveWatchlist } from "../../utils/watchlistStorage";
import { price } from "../../utils/format";
import styles from "./MarketOverview.module.scss";

function Cell({ exchange, symbol, listed }: { exchange: string; symbol: string; listed: boolean }) {
  const live = useLivePrice(exchange, symbol, "FUT").price;
  if (live != null) return <span className={styles.num}>{price(live)}</span>;
  return <span className={styles.mute}>{listed ? "listed" : "—"}</span>;
}

/** TradingView-style coin search: ⌘K / Ctrl K, arrows, Enter = chart, Shift+Enter = watchlist. */
const CoinSearch: React.FC<{ fallback: readonly string[] }> = ({ fallback }) => {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [all, setAll] = useState<string[]>([...fallback]);
  const [note, setNote] = useState<string | null>(null);
  const svc = SymbolService.getInstance();

  useEffect(() => {
    let alive = true;
    void svc.fetchAllSymbols().then((list) => {
      if (alive && list.length > 0) setAll([...new Set([...fallback, ...list])]);
    });
    return () => {
      alive = false;
    };
  }, [svc, fallback]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const results = useMemo(() => {
    const q = query
      .trim()
      .toUpperCase()
      .replace(/[-/]?USDT?$/, "");
    if (!q) return [];
    const starts = all.filter((s) => s.startsWith(q));
    const contains = all.filter((s) => !s.startsWith(q) && s.split("-")[0].includes(q));
    return [...starts, ...contains].slice(0, 8);
  }, [query, all]);

  const open = (symbol: string, addToWatchlist: boolean) => {
    if (addToWatchlist) {
      const list = loadWatchlist();
      if (!list.includes(symbol)) {
        saveWatchlist([...list, symbol]);
        MarketDataService.getInstance().startMarketData(symbol);
      }
      setNote(`${symbol} added to your watchlist.`);
      setQuery("");
      return;
    }
    void navigate(`/chart/${symbol}`);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter" && results[active]) {
      e.preventDefault();
      open(results[active], e.shiftKey);
    } else if (e.key === "Escape") {
      setQuery("");
    }
  };

  const listed = (s: string) => svc.listedOn(s);

  return (
    <div className={styles.search}>
      <label htmlFor={`${listId}-input`} className="sr-only">
        Search coins
      </label>
      <div className={styles.searchBox}>
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" />
        </svg>
        <input
          ref={inputRef}
          id={`${listId}-input`}
          type="search"
          role="combobox"
          aria-expanded={results.length > 0}
          aria-controls={listId}
          aria-activedescendant={results[active] ? `${listId}-${active}` : undefined}
          autoComplete="off"
          placeholder="Search a coin, e.g. SOL"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setNote(null);
          }}
          onKeyDown={onKeyDown}
        />
        <kbd aria-hidden="true">⌘K</kbd>
      </div>
      {note && (
        <p className={styles.faint} role="status">
          {note}
        </p>
      )}
      {results.length > 0 && (
        <div className={styles.results}>
          <div className={styles.resultHead} aria-hidden="true">
            <span>Coin</span>
            <span>Binance</span>
            <span>OKX</span>
            <span>Delta (USD)</span>
          </div>
          <ul id={listId} role="listbox" aria-label="Matching coins">
            {results.map((s, i) => {
              const l = listed(s);
              return (
                <li
                  key={s}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  className={styles.result}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    open(s, e.shiftKey);
                  }}
                >
                  <span>
                    <b>{s.split("-")[0]}</b>
                    <span className={styles.mute}>-{s.split("-")[1]}</span>
                  </span>
                  <Cell exchange="BINANCE" symbol={s} listed={l.binance} />
                  <Cell exchange="OKX" symbol={s} listed={l.okx} />
                  <Cell exchange="DELTA" symbol={s} listed={false} />
                </li>
              );
            })}
          </ul>
          <p className={styles.resultsFoot}>
            Enter opens the chart · Shift+Enter adds to watchlist · prices show for streamed coins
          </p>
        </div>
      )}
    </div>
  );
};

export default CoinSearch;
