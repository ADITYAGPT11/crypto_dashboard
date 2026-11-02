import { useConnectionSummary } from "../../custom-hooks/useConnectionSummary";
import type { ConnectionState } from "../../types/connection";
import styles from "./MarketOverview.module.scss";

const EXCHANGES = [
  { id: "BINANCE", name: "Binance", markets: "spot + perp" },
  { id: "OKX", name: "OKX", markets: "spot + swap" },
  { id: "DELTA", name: "Delta", markets: "perp, USD" },
];

const DOT: Record<ConnectionState, string> = {
  live: styles.dotLive,
  connecting: styles.dotConnecting,
  down: styles.dotDown,
};

/** Which exchanges are connected right now. */
const Connections: React.FC = () => {
  const states = useConnectionSummary();
  return (
    <ul className={styles.conns} aria-label="Exchange connections">
      {EXCHANGES.map((e) => {
        const state = states[e.id] ?? "connecting";
        return (
          <li key={e.id} className={styles.conn}>
            <span className={`${styles.dot} ${DOT[state]}`} aria-hidden="true" />
            <span>
              <b>{e.name}</b>{" "}
              <small>
                {state} · {e.markets}
              </small>
            </span>
          </li>
        );
      })}
    </ul>
  );
};

export default Connections;
