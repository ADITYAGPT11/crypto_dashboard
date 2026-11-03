import { useState } from "react";
import type { MarketOverview } from "../../services/MarketOverviewService";
import { sumLiquidations } from "../../utils/marketOverview";
import { price } from "../../utils/format";
import { ago, clock, usdCompact } from "./format";
import styles from "./MarketOverview.module.scss";

const WINDOWS = { "1h": 3_600_000, "24h": 86_400_000 } as const;

/** Long vs short liquidations from Binance's public stream, since the page opened. */
const Liquidations: React.FC<{ liq: MarketOverview["liquidations"]; now: number }> = ({
  liq,
  now,
}) => {
  const [win, setWin] = useState<keyof typeof WINDOWS>("1h");
  const since = now - WINDOWS[win];
  const s = sumLiquidations(liq.list, since);
  const total = s.long + s.short;
  const longShare = total > 0 ? s.long / total : 0;
  const partial = liq.since > since;

  return (
    <section className={`${styles.card} ${styles.third}`} aria-labelledby="liq-title">
      <div className={styles.cardHead}>
        <h2 id="liq-title">Liquidations</h2>
        <div
          className={styles.pills}
          role="group"
          aria-label="Window"
          style={{ marginLeft: "auto" }}
        >
          {(Object.keys(WINDOWS) as (keyof typeof WINDOWS)[]).map((w) => (
            <button
              key={w}
              type="button"
              className={styles.pill}
              aria-pressed={w === win}
              onClick={() => setWin(w)}
            >
              {w}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.stack}>
        <div className={styles.kv}>
          <span>Longs liquidated</span>
          <span className={`${styles.num} ${styles.down}`}>{usdCompact(s.long)}</span>
        </div>
        <div className={styles.kv}>
          <span>Shorts liquidated</span>
          <span className={`${styles.num} ${styles.up}`}>{usdCompact(s.short)}</span>
        </div>
        <div
          className={styles.split}
          role="img"
          aria-label={
            total > 0
              ? `${Math.round(longShare * 100)}% of liquidations were longs`
              : "No liquidations yet"
          }
        >
          <span style={{ width: `${longShare * 100}%` }} />
          <span style={{ width: `${total > 0 ? (1 - longShare) * 100 : 0}%` }} />
        </div>
        <span className={styles.mute} style={{ fontSize: 12 }}>
          {total === 0
            ? liq.state === "live"
              ? "None recorded in this window yet."
              : `Stream ${liq.state}.`
            : longShare >= 0.6
              ? `${Math.round(longShare * 100)}% longs: price moved against crowded longs.`
              : longShare <= 0.4
                ? `${Math.round((1 - longShare) * 100)}% shorts: price moved against crowded shorts.`
                : "Roughly balanced between longs and shorts."}
        </span>
        {s.largest && (
          <div style={{ borderTop: "1px solid var(--t-inner)", paddingTop: 8, fontSize: 13 }}>
            <span className={styles.mute} style={{ display: "block", fontSize: 12 }}>
              Largest single
            </span>
            <b>{s.largest.symbol.split("-")[0]}</b> {s.largest.side} ·{" "}
            <span className={styles.num}>
              {usdCompact(s.largest.usd)} at {price(s.largest.price)}
            </span>{" "}
            · {ago(s.largest.time, now)}
          </div>
        )}
        <p className={styles.faint} style={{ margin: 0 }}>
          Binance only. Its public stream sends at most one liquidation per coin per second, so
          totals undercount.{partial ? ` Collecting since ${clock(liq.since)} (page open).` : ""}
        </p>
      </div>
    </section>
  );
};

export default Liquidations;
