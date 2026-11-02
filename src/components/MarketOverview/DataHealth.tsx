import { LiveMarketDataService } from "../../services/LiveMarketDataService";
import { useConnectionSummary } from "../../custom-hooks/useConnectionSummary";
import { useSetupAlerts } from "../../custom-hooks/useSetupAlerts";
import type { ConnectionState } from "../../types/connection";
import { ago, clock } from "./format";
import styles from "./MarketOverview.module.scss";

const DOT: Record<ConnectionState, string> = {
  live: styles.dotLive,
  connecting: styles.dotConnecting,
  down: styles.dotDown,
};

const TELEGRAM = {
  unknown: "checking",
  configured: "Telegram ok",
  notConfigured: "Telegram not set up",
  offline: "backend offline",
} as const;

/** Is every feed fresh, and how much history is the analysis using? */
const DataHealth: React.FC<{
  now: number;
  coins: number;
  universe: number;
  days: number;
  lastCandle: number | null;
  overviewUpdatedAt: number | null;
}> = ({ now, coins, universe, days, lastCandle, overviewUpdatedAt }) => {
  const states = useConnectionSummary();
  const alerts = useSetupAlerts();
  const live = LiveMarketDataService.getInstance();
  const active = alerts.rules.filter((r) => !r.paused).length;
  const feeds = [
    ["BINANCE", "Binance feed"],
    ["OKX", "OKX feed"],
    ["DELTA", "Delta feed"],
  ] as const;
  return (
    <section className={styles.card} aria-labelledby="health-title">
      <div className={styles.cardHead}>
        <h2 id="health-title">Data health</h2>
      </div>
      <ul className={styles.list}>
        {feeds.map(([id, name]) => {
          const state = states[id] ?? "connecting";
          return (
            <li key={id}>
              <span className={styles.item}>
                <span className={`${styles.dot} ${DOT[state]}`} aria-hidden="true" />
                <b>{name}</b>
                <span className={`${styles.num} ${state === "live" ? styles.mute : styles.warn}`}>
                  {state} · last tick {ago(live.getLatestUpdateForExchange(id), now)}
                </span>
              </span>
            </li>
          );
        })}
        <li>
          <span className={styles.item}>
            <b>History</b>
            <span className={`${styles.num} ${styles.mute}`}>
              {coins}/{universe} coins · {days} d · 4h
            </span>
          </span>
        </li>
        <li>
          <span className={styles.item}>
            <b>Last closed candle</b>
            <span className={`${styles.num} ${styles.mute}`}>{clock(lastCandle)}</span>
          </span>
        </li>
        <li>
          <span className={styles.item}>
            <b>Market data</b>
            <span className={`${styles.num} ${styles.mute}`}>
              updated {ago(overviewUpdatedAt, now)}
            </span>
          </span>
        </li>
        <li>
          <span className={styles.item}>
            <b>Alerts</b>
            <span className={`${styles.num} ${styles.mute}`}>
              {active} active · {TELEGRAM[alerts.telegram]}
            </span>
          </span>
        </li>
      </ul>
    </section>
  );
};

export default DataHealth;
