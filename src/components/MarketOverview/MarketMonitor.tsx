import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { CoinRow } from "../../utils/marketRows";
import { price } from "../../utils/format";
import { signed, tone, usdCompact } from "./format";
import styles from "./MarketOverview.module.scss";

type Key =
  | "symbol"
  | "change24h"
  | "change7d"
  | "quoteVolume"
  | "vol7d"
  | "atr4h"
  | "fundingPct"
  | "oiChange24h"
  | "corrBtc";

const COLS: { key: Key; label: string; numeric: boolean }[] = [
  { key: "change24h", label: "24h", numeric: true },
  { key: "change7d", label: "7d", numeric: true },
  { key: "quoteVolume", label: "24h volume", numeric: true },
  { key: "vol7d", label: "Volatility 7d", numeric: true },
  { key: "atr4h", label: "ATR 4h", numeric: true },
  { key: "fundingPct", label: "Funding", numeric: true },
  { key: "oiChange24h", label: "OI 24h", numeric: true },
  { key: "corrBtc", label: "Corr. BTC", numeric: true },
];

function Trend({ up, tf }: { up: boolean | null; tf: string }) {
  if (up == null) return <span className={styles.mute}>— </span>;
  return (
    <span
      className={`${styles.trend} ${up ? styles.trendUp : styles.trendDown}`}
      title={`${tf}: close ${up ? "above" : "below"} EMA 50`}
    >
      {tf} {up ? "↑" : "↓"}
    </span>
  );
}

const cls = (v: number | null) => styles[tone(v)];

/** One row per coin: price action, volatility, trend and positioning. */
const MarketMonitor: React.FC<{ rows: readonly CoinRow[] }> = ({ rows }) => {
  const [sort, setSort] = useState<{ key: Key; desc: boolean }>({ key: "quoteVolume", desc: true });
  const sorted = useMemo(() => {
    const val = (r: CoinRow) => {
      const v = r[sort.key];
      return typeof v === "number" && Number.isFinite(v) ? v : Number.NEGATIVE_INFINITY;
    };
    return [...rows].sort((a, b) =>
      sort.key === "symbol"
        ? a.symbol.localeCompare(b.symbol) * (sort.desc ? -1 : 1)
        : (val(b) - val(a)) * (sort.desc ? 1 : -1),
    );
  }, [rows, sort]);

  const header = (key: Key, label: string, numeric: boolean) => (
    <th
      key={key}
      scope="col"
      className={numeric ? styles.r : undefined}
      aria-sort={sort.key === key ? (sort.desc ? "descending" : "ascending") : "none"}
    >
      <button
        type="button"
        className={styles.pill}
        style={{ border: 0, background: "none", padding: 0, minHeight: 32 }}
        onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : true }))}
      >
        {label}
        {sort.key === key ? (sort.desc ? " ↓" : " ↑") : ""}
      </button>
    </th>
  );

  return (
    <section className={styles.card} aria-labelledby="mon-title">
      <div className={styles.cardHead}>
        <h2 id="mon-title">Market monitor</h2>
        <p>Binance perps · volatility and trend from closed 4h candles · click a column to sort</p>
      </div>
      <div className={styles.xs}>
        <table className={styles.tbl}>
          <thead>
            <tr>
              {header("symbol", "Coin", false)}
              <th scope="col" className={styles.r}>
                Price
              </th>
              {COLS.slice(0, 5).map((c) => header(c.key, c.label, c.numeric))}
              <th scope="col">Trend 4h · 1d</th>
              {COLS.slice(5).map((c) => header(c.key, c.label, c.numeric))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.symbol}>
                <td>
                  <Link className={styles.coinLink} to={`/chart/${r.symbol}`}>
                    {r.base}
                  </Link>
                </td>
                <td className={`${styles.r} ${styles.num}`}>{price(r.price)}</td>
                <td className={`${styles.r} ${styles.num} ${cls(r.change24h)}`}>
                  {signed(r.change24h)}
                </td>
                <td className={`${styles.r} ${styles.num} ${cls(r.change7d)}`}>
                  {signed(r.change7d)}
                </td>
                <td className={`${styles.r} ${styles.num} ${styles.mute}`}>
                  {usdCompact(r.quoteVolume)}
                </td>
                <td className={`${styles.r} ${styles.num}`}>
                  {Number.isFinite(r.vol7d) ? `${r.vol7d.toFixed(0)}%` : "—"}
                </td>
                <td className={`${styles.r} ${styles.num}`}>
                  {Number.isFinite(r.atr4h) ? `${r.atr4h.toFixed(1)}%` : "—"}
                </td>
                <td>
                  <Trend up={r.trend4h} tf="4h" />
                  <Trend up={r.trend1d} tf="1d" />
                </td>
                <td
                  className={`${styles.r} ${styles.num} ${r.fundingPct != null && Math.abs(r.fundingPct) >= 0.03 ? styles.warn : ""}`}
                >
                  {signed(r.fundingPct, 4)}
                </td>
                <td className={`${styles.r} ${styles.num} ${cls(r.oiChange24h)}`}>
                  {signed(r.oiChange24h)}
                </td>
                <td className={`${styles.r} ${styles.num}`}>
                  {r.corrBtc == null || !Number.isFinite(r.corrBtc) ? "—" : r.corrBtc.toFixed(2)}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={11} className={styles.mute}>
                  Loading prices and history…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className={styles.faint} style={{ marginTop: 10 }}>
        Volatility = annualised standard deviation of 4h returns over 7 days. ATR = average true
        range (14 × 4h) as % of price. Trend = close above or below EMA 50. Funding per 8h, amber
        when crowded (±0.03% or more). Correlation = 30 days of 4h returns.
      </p>
    </section>
  );
};

export default MarketMonitor;
