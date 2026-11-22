import { Link } from "react-router-dom";
import type { Candle } from "../../types/marketData";
import { useLivePrice } from "../../custom-hooks/useLivePrice";
import { signedPct } from "../../utils/format";
import { Icon } from "./icons";
import styles from "./ChartPage.module.scss";

/** 1h candles back for the change figure. */
const DAY_BARS = 24;

/** Change over the last 24 hours from 1h candles, using the live price when there is one. */
export function dayChange(candles: readonly Candle[], live: number | null): number | null {
  const last = candles[candles.length - 1];
  const now = live ?? last?.close;
  const ref = candles[Math.max(0, candles.length - 1 - DAY_BARS)]?.close;
  return now != null && ref ? ((now - ref) / ref) * 100 : null;
}

function Chip({
  symbol,
  candles,
  current,
}: {
  symbol: string;
  candles: readonly Candle[];
  current: boolean;
}) {
  const live = useLivePrice("BINANCE", symbol, "FUT").price;
  const change = dayChange(candles, live);
  return (
    <Link
      className={styles.wChip}
      to={`/chart/${symbol}`}
      aria-current={current ? "page" : undefined}
      title={`${symbol}: change over 24 hours`}
    >
      <b>{symbol}</b>
      <span
        className={`${styles.num} ${change == null ? "" : change >= 0 ? styles.up : styles.down}`}
      >
        {change == null ? "—" : signedPct(change, 2)}
      </span>
    </Link>
  );
}

/** The Dashboard's watchlist as one-click chips above the chart. */
const WatchlistStrip: React.FC<{
  symbols: readonly string[];
  current: string;
  candles: ReadonlyMap<string, Candle[]>;
  onToggleCurrent: () => void;
}> = ({ symbols, current, candles, onToggleCurrent }) => {
  const listed = symbols.includes(current);
  return (
    <nav className={styles.wStrip} aria-label="Watchlist">
      {symbols.map((s) => (
        <Chip key={s} symbol={s} candles={candles.get(s) ?? []} current={s === current} />
      ))}
      <button type="button" className={styles.wAdd} aria-pressed={listed} onClick={onToggleCurrent}>
        <Icon name="star" size={14} filled={listed} />
        {listed ? `Remove ${current}` : `Add ${current}`}
      </button>
    </nav>
  );
};

export default WatchlistStrip;
