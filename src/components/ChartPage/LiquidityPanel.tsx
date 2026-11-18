import type { LiquiditySnapshot } from "../../services/LiquidityService";
import type { DepthHistory } from "../../custom-hooks/useDepthHistory";
import type { LiquidityPool } from "../../utils/liquidityHeatmap";
import { Chip, Explain } from "../../common-components/Evidence";
import { price } from "../../utils/format";
import styles from "./ChartPage.module.scss";

function money(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

const STATE_TONE = { live: "up", connecting: "lock", down: "down" } as const;

/** Feed status and the biggest resting pools in the visible order books. */
function historyText(h: DepthHistory, since: number | undefined, liveSince: number | undefined) {
  if (h.status === "loading") return " · loading recorded history…";
  if (h.status === "unavailable")
    return " · no recorded history (the analysis service is not running): the heatmap starts now";
  if (h.samples.length > 0 && since !== undefined && since !== liveSince)
    return ` · recorded by the analysis service since ${new Date(since).toLocaleString()}`;
  if (h.recording) return " · the analysis service is recording this coin from now on";
  return "";
}

const LiquidityPanel: React.FC<{
  liquidity: LiquiditySnapshot;
  pools: LiquidityPool[];
  history: DepthHistory;
  /** First sample shown (recorded history or live). */
  since: number | undefined;
}> = ({ liquidity, pools, history, since }) => {
  const last = liquidity.samples[liquidity.samples.length - 1];
  const liveSince = liquidity.samples[0]?.time;
  return (
    <section className={styles.card} aria-labelledby="liq-title">
      <div className={styles.cardHead}>
        <h2 id="liq-title">Liquidity pools (order book)</h2>
        <Explain title="Liquidity heatmap">
          Resting limit orders from the order books of all three exchanges (Binance, OKX and Delta
          Exchange perpetuals), added together within ±2% of the price and bucketed by price (
          {last ? price(last.bucket) : "…"} per bucket). The chart's heatmap shows the average
          resting size per bar: recorded by the analysis service (one column per minute, kept for a
          week) and then live from this page every 2 seconds. The table lists the largest buckets on
          each side; a wall is at least 3× the median bucket on its side, and "for" is how long it
          has held at least half its size. This is an observation: visible orders can be pulled or
          spoofed, and who placed them is unknown.
        </Explain>
        <p>
          {Object.entries(liquidity.feeds).map(([ex, f]) => (
            <span key={ex} className={styles.feedChip}>
              <Chip tone={STATE_TONE[f.state]}>
                {ex} {f.state}
              </Chip>{" "}
              <span className={styles.mute}>
                {f.state === "live"
                  ? `${f.levels} levels${f.share !== null ? ` · ${Math.round(f.share * 100)}% of liquidity` : ""}`
                  : (f.error ?? "")}
              </span>{" "}
            </span>
          ))}
          {liveSince ? (
            <span className={styles.mute}>
              {" "}
              · sampling every 2 s since {new Date(liveSince).toLocaleTimeString()}
            </span>
          ) : null}
          <span className={styles.mute}>{historyText(history, since, liveSince)}</span>
        </p>
      </div>
      <div className={styles.xs}>
        <table className={styles.tbl}>
          <thead>
            <tr>
              <th>Side</th>
              <th className={styles.r}>Price</th>
              <th className={styles.r}>Resting</th>
              <th className={styles.r}>× median</th>
              <th className={styles.r}>From mid</th>
              <th className={styles.r}>For</th>
            </tr>
          </thead>
          <tbody>
            {pools.map((p) => (
              <tr key={`${p.side}${p.low}`}>
                <td>
                  <Chip tone={p.side === "bid" ? "up" : "down"}>
                    {p.side === "bid" ? "Bids" : "Asks"}
                  </Chip>
                </td>
                <td className={`${styles.r} ${styles.num}`}>
                  {price(p.low)}–{price(p.high)}
                </td>
                <td className={`${styles.r} ${styles.num}`}>{money(p.notional)}</td>
                <td className={`${styles.r} ${styles.num}`}>{p.multiple.toFixed(1)}×</td>
                <td className={`${styles.r} ${styles.num}`}>
                  {p.distancePct >= 0 ? "+" : ""}
                  {p.distancePct.toFixed(2)}%
                </td>
                <td className={`${styles.r} ${styles.mute}`}>{duration(p.restingMs)}</td>
              </tr>
            ))}
            {pools.length === 0 && (
              <tr>
                <td colSpan={6} className={styles.mute}>
                  {last
                    ? "No bucket stands out from the rest of the book right now."
                    : "Connecting to the order books…"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
};

export default LiquidityPanel;
