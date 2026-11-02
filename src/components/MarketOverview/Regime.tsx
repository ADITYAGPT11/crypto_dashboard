import type { VolRegimeResult } from "../../utils/marketStats";
import { sessionsAt } from "../../utils/marketStats";
import styles from "./MarketOverview.module.scss";

const LABEL = { calm: "Calm", normal: "Normal", elevated: "Elevated" } as const;
const ROWS = [6, 24, 42];

/** BTC volatility regime plus the trading sessions open right now. */
const Regime: React.FC<{ regime: VolRegimeResult | null; now: number }> = ({ regime, now }) => {
  const { hour, sessions } = sessionsAt(now);
  const open = sessions.filter((s) => s.isOpen).map((s) => s.name);
  const hh = String(Math.floor(hour)).padStart(2, "0");
  const mm = String(Math.floor((hour % 1) * 60)).padStart(2, "0");
  return (
    <section className={`${styles.card} ${styles.third}`} aria-labelledby="reg-title">
      <div className={styles.cardHead}>
        <h2 id="reg-title">Volatility regime</h2>
      </div>
      {regime ? (
        <div className={styles.stack}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span className={styles.num} style={{ fontSize: 26, fontWeight: 600 }}>
              {regime.current.toFixed(0)}%
            </span>
            <span
              className={styles.lbl}
              style={{ color: regime.regime === "elevated" ? "var(--t-amber)" : "var(--t-signal)" }}
            >
              {LABEL[regime.regime]}
            </span>
          </div>
          <div
            className={styles.bar}
            role="img"
            aria-label={`BTC 7-day volatility at the ${Math.round(regime.percentile * 100)}th percentile of the past ${regime.samples} days`}
          >
            <span style={{ width: `${Math.max(2, regime.percentile * 100)}%` }} />
          </div>
          <span className={styles.mute} style={{ fontSize: 12 }}>
            BTC 7-day volatility (annualised) is at the {Math.round(regime.percentile * 100)}th
            percentile of the past {regime.samples} days.{" "}
            {regime.regime === "calm"
              ? "Calm periods often end in larger moves; direction unknown."
              : regime.regime === "elevated"
                ? "Expect wider candles: size positions down."
                : ""}
          </span>
        </div>
      ) : (
        <p className={styles.mute}>Needs about 40 days of BTC history; loading…</p>
      )}
      <div
        className={styles.stack}
        style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--t-inner)" }}
      >
        <b style={{ fontSize: 13 }}>
          Sessions{" "}
          <span className={styles.mute} style={{ fontWeight: 400 }}>
            · now {hh}:{mm} UTC
          </span>
        </b>
        <div
          className={styles.sessions}
          role="img"
          aria-label={`Sessions in UTC: ${sessions.map((s) => `${s.name} ${s.open} to ${s.close}`).join(", ")}. Open now: ${open.join(" and ") || "none"}.`}
        >
          {sessions.map((s, i) => (
            <span
              key={s.name}
              className={s.isOpen ? styles.sessOn : styles.sessOff}
              style={{
                top: ROWS[i],
                left: `${(s.open / 24) * 100}%`,
                width: `${((s.close - s.open) / 24) * 100}%`,
              }}
            >
              {s.name}
            </span>
          ))}
          <span className={styles.nowLine} style={{ left: `${(hour / 24) * 100}%` }} />
        </div>
        <span className={styles.mute} style={{ fontSize: 12 }}>
          {open.length === 2 && open.includes("London") && open.includes("New York")
            ? "London–New York overlap: usually the most liquid hours."
            : open.length
              ? `${open.join(" and ")} open.`
              : "Between sessions: thinner liquidity is common."}{" "}
          Approximate hours, no daylight-saving shift.
        </span>
      </div>
    </section>
  );
};

export default Regime;
