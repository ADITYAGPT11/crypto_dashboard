import type { MarketOverview } from "../../services/MarketOverviewService";
import type { CoinRow } from "../../utils/marketRows";
import { meanOf } from "../../utils/marketRows";
import { clock, signed } from "./format";
import styles from "./MarketOverview.module.scss";

const ARC = ["#f47067", "#f0a35e", "#7d8896", "#8fd694", "#56d364"];
const CX = 120;
const CY = 120;
const R = 96;

function point(v: number, r = R): [number, number] {
  const t = Math.PI - (v / 100) * Math.PI;
  return [CX + r * Math.cos(t), CY - r * Math.sin(t)];
}

function Gauge({ value }: { value: number | null }) {
  const n = value == null ? null : point(Math.max(0, Math.min(100, value)), 70);
  return (
    <svg width="240" height="132" viewBox="0 0 240 132" aria-hidden="true">
      {ARC.map((c, k) => {
        const [x1, y1] = point(k * 20 + 1);
        const [x2, y2] = point(k * 20 + 19);
        return (
          <path
            key={c}
            d={`M ${x1.toFixed(1)} ${y1.toFixed(1)} A ${R} ${R} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`}
            stroke={c}
            strokeWidth="16"
            fill="none"
          />
        );
      })}
      {n && (
        <line
          x1={CX}
          y1={CY}
          x2={n[0]}
          y2={n[1]}
          stroke="var(--t-fg)"
          strokeWidth="3"
          strokeLinecap="round"
        />
      )}
      <circle cx={CX} cy={CY} r="6" fill="var(--t-fg)" />
    </svg>
  );
}

function fgTone(v: number): string {
  return v < 25 ? styles.down : v < 45 ? styles.warn : v <= 55 ? styles.flat : styles.up;
}

/** Fear & Greed first, then observable positioning gauges. No combined score. */
const Sentiment: React.FC<{
  overview: MarketOverview;
  rows: readonly CoinRow[];
}> = ({ overview, rows }) => {
  const fg = overview.fearGreed;
  const funding = meanOf([...overview.funding.value.values()].map((f) => f.fundingPct));
  const ls = meanOf([...overview.longShort.value.values()]);
  const oi = meanOf([...overview.openInterest.value.values()]);
  const up = rows.filter((r) => r.change24h > 0).length;
  const above = rows.filter((r) => r.trend4h === true).length;
  const dom = overview.btcDominance;
  const unavailable = <span className={styles.mute}>unavailable</span>;

  return (
    <section className={`${styles.card} ${styles.side}`} aria-labelledby="sent-title">
      <div className={styles.cardHead}>
        <h2 id="sent-title">Market sentiment</h2>
      </div>
      <div
        className={styles.gauge}
        role="img"
        aria-label={
          fg.value
            ? `Fear and Greed Index ${fg.value.value} of 100: ${fg.value.label}`
            : "Fear and Greed Index unavailable"
        }
      >
        <Gauge value={fg.value?.value ?? null} />
        {fg.value ? (
          <>
            <span className={styles.gaugeNum}>{fg.value.value}</span>
            <b className={fgTone(fg.value.value)}>{fg.value.label}</b>
            <span className={styles.mute} style={{ fontSize: 12 }}>
              Fear &amp; Greed Index · yesterday {fg.value.yesterday ?? "—"} · last week{" "}
              {fg.value.lastWeek ?? "—"}
            </span>
            <span className={styles.faint}>alternative.me · {clock(fg.value.time)}</span>
          </>
        ) : (
          <span className={styles.mute}>
            Fear &amp; Greed Index{" "}
            {fg.state === "loading" ? "loading…" : "unavailable (alternative.me not reachable)"}
          </span>
        )}
      </div>
      <dl className={styles.metrics}>
        <div>
          <dt>
            Funding (avg, {overview.funding.value.size} coins)
            <small>
              {funding == null ? "" : funding >= 0 ? "longs pay shorts" : "shorts pay longs"}
            </small>
          </dt>
          <dd className={funding != null && funding >= 0.03 ? styles.warn : undefined}>
            {funding == null ? unavailable : `${signed(funding, 4)} / 8h`}
          </dd>
        </div>
        <div>
          <dt>
            Long / short accounts
            <small>Binance perps, avg of {overview.longShort.value.size} coins</small>
          </dt>
          <dd>{ls == null ? unavailable : ls.toFixed(2)}</dd>
        </div>
        <div>
          <dt>
            Open interest, 24h
            <small>
              {oi == null ? "" : oi >= 0 ? "more positions opened" : "positions closed"}
            </small>
          </dt>
          <dd className={oi == null ? undefined : oi >= 0 ? styles.up : styles.down}>
            {oi == null ? unavailable : signed(oi)}
          </dd>
        </div>
        <div>
          <dt>
            Breadth
            <small>up in 24h · above EMA 50 (4h)</small>
          </dt>
          <dd>{rows.length ? `${up}/${rows.length} · ${above}/${rows.length}` : unavailable}</dd>
        </div>
        <div>
          <dt>
            BTC dominance
            <small>CoinGecko · share of total market cap</small>
          </dt>
          <dd>{dom.value == null ? unavailable : `${dom.value.toFixed(1)}%`}</dd>
        </div>
      </dl>
      <p className={styles.note}>
        Each gauge is an observation, not a forecast. They aren't combined into one score until
        we've measured whether such a score predicts anything.
      </p>
    </section>
  );
};

export default Sentiment;
