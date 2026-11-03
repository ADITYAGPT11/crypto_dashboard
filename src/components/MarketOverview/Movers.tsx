import { Link } from "react-router-dom";
import type { CoinRow } from "../../utils/marketRows";
import { price } from "../../utils/format";
import { signed } from "./format";
import styles from "./MarketOverview.module.scss";

function List({ title, rows, up }: { title: string; rows: readonly CoinRow[]; up: boolean }) {
  return (
    <section className={styles.card} aria-label={title}>
      <div className={styles.cardHead}>
        <h2>{title}</h2>
      </div>
      <ul className={styles.list}>
        {rows.map((r) => (
          <li key={r.symbol}>
            <Link to={`/chart/${r.symbol}`}>
              <b>{r.base}</b>
              <span className={`${styles.num} ${styles.mute}`}>{price(r.price)}</span>
              <span
                className={`${styles.num} ${up ? styles.up : styles.down}`}
                style={{ width: 72, textAlign: "right" }}
              >
                {signed(r.change24h)}
              </span>
            </Link>
          </li>
        ))}
        {rows.length === 0 && (
          <li>
            <span className={`${styles.item} ${styles.mute}`}>Loading…</span>
          </li>
        )}
      </ul>
    </section>
  );
}

export const Gainers: React.FC<{ rows: readonly CoinRow[] }> = ({ rows }) => (
  <List title="Top gainers · 24h" rows={rows} up />
);
export const Losers: React.FC<{ rows: readonly CoinRow[] }> = ({ rows }) => (
  <List title="Top losers · 24h" rows={rows} up={false} />
);
