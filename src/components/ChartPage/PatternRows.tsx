import { Link } from "react-router-dom";
import type { RunOut } from "../../api/schema";
import type { CandleInterval } from "../../types/marketData";
import type { SetupOccurrence, SetupStats } from "../../types/analysis";
import { Explain } from "../../common-components/Evidence";
import type { PatternGroup } from "../../utils/patternGroups";
import { patternLabel } from "../../utils/patternLabels";
import { setupKey } from "../../utils/setupKeys";
import { pct, price, shortDate, signedPct, signedR } from "../../utils/format";
import { TfBadge } from "./TfBadge";
import styles from "./ChartPage.module.scss";

/** A detection on the chart: the occurrence plus the timeframe it was found on. */
export interface Found {
  occ: SetupOccurrence;
  pattern: string;
  direction: SetupOccurrence["direction"];
  tf: CandleInterval;
  zoneTf: CandleInterval;
  /** Close time of the confirmation candle (when the signal existed). */
  closeTime: number;
}

interface Props {
  symbol: string;
  groups: PatternGroup<Found>[];
  /** Open row (`pattern|direction`); its newest detection is the one drawn. */
  openId: string | null;
  onOpen: (g: PatternGroup<Found>) => void;
  /** Timeframes picked in the Patterns settings: one table row each. */
  tfs: readonly CandleInterval[];
  /** This coin's own record per timeframe, keyed `pattern|direction|*`. */
  stats: ReadonlyMap<CandleInterval, ReadonlyMap<string, SetupStats>>;
  isNow: (f: Found) => boolean;
  run: RunOut | null;
  statsError: string | null;
  ruleset: string | null;
  maxHoldBars: number;
  /** ATRs the stop trails behind the best price after TP1 (`outcomes.py` TRAIL_ATR). */
  trailAtr: number;
  minSample: number;
  loading: boolean;
  /** Empty-state text when nothing is listed and nothing is loading. */
  empty: string;
}

const keyOf = (g: Pick<PatternGroup<Found>, "pattern" | "direction">) =>
  setupKey(g.pattern, g.direction, "*");

function whenText(f: Found, now: boolean) {
  return now ? "Now" : shortDate(f.closeTime - 1);
}

function statusText(run: RunOut | null, error: string | null): string {
  if (error) return error;
  if (!run) return "Not measured yet: the background job starts with the analysis service.";
  if (run.status === "running")
    return `Measuring in the background: ${run.done}/${run.coins.length} coins…`;
  if (run.status === "failed") return "The last statistics run failed; it retries within the hour.";
  return "";
}

/** One row per timeframe: this coin's record of the pattern on it. */
function TfTable({
  group,
  tfs,
  stats,
  minSample,
}: {
  group: PatternGroup<Found>;
  tfs: readonly CandleInterval[];
  stats: Props["stats"];
  minSample: number;
}) {
  const key = keyOf(group);
  return (
    <div className={styles.xs}>
      <table className={`${styles.tbl} ${styles.tfTbl}`}>
        <caption className="sr-only">
          {patternLabel(group.pattern)} {group.direction}: record on this coin per timeframe
        </caption>
        <thead>
          <tr>
            <th scope="col">TF</th>
            <th scope="col" className={styles.r}>
              Cases
            </th>
            <th scope="col" className={styles.r}>
              Win
            </th>
            <th scope="col" className={styles.r}>
              95% range
            </th>
            <th scope="col" className={styles.r}>
              Break-even
            </th>
            <th scope="col" className={styles.r}>
              Avg after costs
            </th>
          </tr>
        </thead>
        <tbody>
          {tfs.map((tf) => {
            const st = stats.get(tf)?.get(key);
            const found = tf === group.latest.tf;
            const thin = !st || st.n < minSample;
            return (
              <tr
                key={tf}
                className={`${found ? styles.tfFound : ""} ${thin ? styles.tfThin : ""}`}
                title={found ? `The detection drawn on the chart is on ${tf}` : undefined}
              >
                <th scope="row">
                  <TfBadge tf={tf} />
                </th>
                <td className={`${styles.r} ${styles.num}`}>
                  {st ? st.n : stats.has(tf) ? 0 : "…"}
                </td>
                {st && !thin ? (
                  <>
                    <td className={`${styles.r} ${styles.num}`}>{pct(st.winRate)}</td>
                    <td className={`${styles.r} ${styles.num}`}>
                      {pct(st.ci[0])}–{pct(st.ci[1])}
                    </td>
                    <td className={`${styles.r} ${styles.num}`}>{pct(st.breakEven)}</td>
                    <td
                      className={`${styles.r} ${styles.num} ${st.expectancyR >= 0 ? styles.up : styles.down}`}
                    >
                      {signedR(st.expectancyR)}
                    </td>
                  </>
                ) : (
                  <td colSpan={4} className={`${styles.r} ${styles.mute}`}>
                    {st || stats.has(tf) ? `fewer than ${minSample} cases` : "loading…"}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Trade plan of the newest detection, with links to size it or set an alert. */
function Plan({
  f,
  now,
  maxHoldBars,
  trailAtr,
}: {
  f: Found;
  now: boolean;
  maxHoldBars: number;
  trailAtr: number;
}) {
  const o = f.occ;
  const rr = Math.abs(o.target - o.entry) / Math.abs(o.entry - o.stop);
  const key = setupKey(o.pattern, o.direction, "*");
  const r = o.outcome;
  const result =
    r.result === "win"
      ? `won ${signedPct(r.movePct)}`
      : r.result === "loss"
        ? `lost ${signedPct(r.movePct)}`
        : r.result === "expired"
          ? `closed at the holding limit, ${signedPct(r.movePct)}`
          : "still open";
  return (
    <div className={styles.rowPlan}>
      <dl className={styles.plan}>
        <div>
          <dt>Entry</dt>
          <dd>{price(o.entry)}</dd>
        </div>
        <div>
          <dt>Stop</dt>
          <dd className={styles.down}>{price(o.stop)}</dd>
        </div>
        <div>
          <dt>TP1 · trail starts</dt>
          <dd className={styles.up}>{price(o.target)}</dd>
        </div>
        <div>
          <dt>Reward : risk to TP1</dt>
          <dd>{rr.toFixed(2)}R</dd>
        </div>
      </dl>
      <p className={styles.note}>
        {now ? "Found on a recent candle" : `Found ${shortDate(f.closeTime - 1)}: ${result}`} ·
        enter at the candle close; at TP1 the stop starts trailing {trailAtr} ATR behind the best
        price, moved at each candle close; holds up to {maxHoldBars} candles or the pattern&apos;s
        length.
      </p>
      <div className={styles.actions}>
        <Link
          className={styles.btn}
          to={`/risk?${new URLSearchParams({
            symbol: o.symbol,
            setup: key,
            tf: f.tf,
            zoneTf: f.zoneTf,
            entry: String(Number(o.entry.toPrecision(8))),
            stop: String(Number(o.stop.toPrecision(8))),
            target: String(Number(o.target.toPrecision(8))),
          }).toString()}`}
        >
          Size in Risk
        </Link>
        <Link
          className={styles.btn}
          to={`/alerts?${new URLSearchParams({ symbol: o.symbol, setup: key, tf: f.tf }).toString()}`}
        >
          Alert me
        </Link>
      </div>
    </div>
  );
}

/** Patterns on this chart: one row each, the open one with its record per timeframe and plan. */
const PatternRows: React.FC<Props> = (p) => {
  const status = statusText(p.run, p.statsError);
  return (
    <section className={styles.card} aria-labelledby="rows-title">
      <div className={styles.rowsHead}>
        <h2 id="rows-title">Patterns on this chart · {p.symbol} only</h2>
        <span className={styles.lbl}>
          Win rate on the timeframe it was found · open a row for every timeframe{" "}
          <Explain title="How these records are measured">
            Every past case of the pattern and direction on {p.symbol} alone, counted by the same
            rules that drew it here, each trade managed by the app&apos;s plan: entry at the
            confirmation close, the pattern stop, and from TP1 a stop trailing {p.trailAtr} ATR
            behind the best price, moved at each candle close and filled on 5-minute candles. A case
            wins when it closes in profit; after {p.maxHoldBars} candles (or the pattern&apos;s own
            length) it closes at the market and counts at its result. The range is the 95% Wilson
            interval; break-even is the win rate needed after fees, slippage and funding. With fewer
            than {p.minSample} cases only the count is shown. In-sample history, not a prediction
            {p.ruleset ? ` (rules ${p.ruleset})` : ""}.
          </Explain>
        </span>
      </div>
      {status && <p className={styles.note}>{status}</p>}
      <ul className={styles.rows}>
        {p.groups.map((g) => {
          const open = g.id === p.openId;
          const f = g.latest;
          const now = p.isNow(f);
          const st = p.stats.get(f.tf)?.get(keyOf(g));
          const long = g.direction === "long";
          const panel = `row-${g.id.replace(/[^a-z0-9]/gi, "-")}`;
          return (
            <li
              key={g.id}
              className={[open ? styles.rowOpen : "", f.occ.passes ? "" : styles.rowFiltered]
                .filter(Boolean)
                .join(" ")}
            >
              <button
                type="button"
                className={styles.rowBtn}
                aria-expanded={open}
                aria-controls={panel}
                onClick={() => p.onOpen(g)}
              >
                <span className={styles.caret} aria-hidden="true">
                  {open ? "▾" : "▸"}
                </span>
                <b>
                  <span className={long ? styles.up : styles.down}>
                    {long ? "▲" : "▼"}
                    <span className="sr-only">{long ? " Long" : " Short"}</span>
                  </span>{" "}
                  {patternLabel(g.pattern)}
                  {!f.occ.passes && (
                    <span
                      className={styles.filtered}
                      title="Filtered out: past setups like this one (same pattern, direction, timeframe and order-flow score) did not clear break-even after costs, or there are too few of them."
                    >
                      Filtered
                    </span>
                  )}
                </b>
                <span className={styles.rowWhere}>
                  <TfBadge tf={f.tf} /> {whenText(f, now)}
                </span>
                <span className={styles.num}>
                  {st && st.n >= p.minSample ? `${pct(st.winRate)} win` : "—"}
                </span>
                <span className={`${styles.num} ${styles.mute}`}>{st ? `n ${st.n}` : ""}</span>
              </button>
              {open && (
                <div id={panel} className={styles.rowBody}>
                  <TfTable group={g} tfs={p.tfs} stats={p.stats} minSample={p.minSample} />
                  <Plan f={f} now={now} maxHoldBars={p.maxHoldBars} trailAtr={p.trailAtr} />
                </div>
              )}
            </li>
          );
        })}
        {!p.loading && p.groups.length === 0 && <li className={styles.rowEmpty}>{p.empty}</li>}
        {p.loading && p.groups.length === 0 && (
          <li className={styles.rowEmpty}>Detecting patterns…</li>
        )}
      </ul>
    </section>
  );
};

export default PatternRows;
