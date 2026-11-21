import type { RunOut } from "../../api/schema";
import type { SetupCase, SetupOccurrence, SetupStats } from "../../types/analysis";
import { CiBar, Explain, VerdictChip } from "../../common-components/Evidence";
import { Link } from "react-router-dom";
import { TfBadge } from "./TfBadge";
import { patternLabel } from "../../utils/patternLabels";
import { setupKey } from "../../utils/setupKeys";
import { pct, price, shortDate, signedPct, signedR } from "../../utils/format";
import styles from "./ChartPage.module.scss";

interface Props {
  occurrence: SetupOccurrence;
  /** Timeframe the pattern was detected on (its levels come from the same one). */
  interval: string;
  zoneTf: string;
  isCurrent: boolean;
  /** Every past case of this pattern and direction, across every coin (background statistics). */
  pooled: SetupStats | null;
  recent: SetupCase[];
  run: RunOut | null;
  statsError: string | null;
  ruleset: string | null;
  maxHoldBars: number;
  minSample: number;
}

function runText(run: RunOut | null, error: string | null): string {
  if (error) return error;
  if (!run)
    return "Statistics not measured yet: the background job starts with the analysis service.";
  if (run.status === "running")
    return `Measuring in the background: ${run.done}/${run.coins.length} coins…`;
  if (run.status === "failed") return "The last statistics run failed; it retries within the hour.";
  return "No past cases of this pattern yet.";
}

const RESULT_MARK: Record<SetupCase["result"], { mark: string; label: string }> = {
  win: { mark: "W", label: "won" },
  loss: { mark: "L", label: "lost" },
  expired: { mark: "E", label: "closed at the holding limit" },
};

const SetupCard: React.FC<Props> = ({
  occurrence: o,
  interval,
  zoneTf,
  isCurrent,
  pooled,
  recent,
  run,
  statsError,
  ruleset,
  maxHoldBars,
  minSample,
}) => {
  const long = o.direction === "long";
  const rr = Math.abs(o.target - o.entry) / Math.abs(o.entry - o.stop);
  const { outcome } = o;
  const resultLabel =
    outcome.result === "win"
      ? `Won ${signedPct(outcome.movePct)}`
      : outcome.result === "loss"
        ? `Lost ${signedPct(outcome.movePct)}`
        : outcome.result === "expired"
          ? `Closed at the holding limit, ${signedPct(outcome.movePct)}`
          : "Still open";
  const coins = run?.coins.length ?? 0;
  const years = run ? Math.round((run.days / 365) * 10) / 10 : null;
  const key = setupKey(o.pattern, o.direction, "*");
  const cases = recent.slice(0, 8);

  return (
    <section className={`${styles.card} ${styles.feature}`} aria-labelledby="setup-title">
      <div className={styles.setupHead}>
        <div>
          <span className={styles.lbl}>
            {isCurrent ? "Setup on a recent candle" : `Setup on ${shortDate(o.time)}`}
            {ruleset ? ` · rules ${ruleset}` : ""}
          </span>
          <h2 id="setup-title">
            <TfBadge tf={interval} />{" "}
            <span className={long ? styles.up : styles.down}>{long ? "Long" : "Short"}</span> ·{" "}
            {patternLabel(o.pattern)}
          </h2>
        </div>
        {pooled && <VerdictChip verdict={pooled.verdict} />}
      </div>

      <div className={styles.big}>
        <div>
          <span className={styles.lbl}>
            Win rate · {coins} coins{years ? ` · ${years} y` : ""}{" "}
            <Explain title="How win rate is measured">
              A case wins when the target is hit before the stop within {maxHoldBars} candles, or
              the pattern&apos;s own length when longer (a candle touching both counts as a loss). A
              trade that reaches neither is closed at the market then and counts at its result.
              Every past case of this pattern and direction across the research coins is counted by
              the same rules that drew it here. The range is the 95% Wilson interval; the amber tick
              is the break-even win rate after costs. Edge candidate means the whole range sits
              above break-even, with at least {minSample} cases.
            </Explain>
          </span>
          {pooled ? (
            <>
              <span className={`${styles.num} ${pooled.verdict === "edge" ? styles.up : ""}`}>
                {pct(pooled.winRate)}
              </span>
              <small>
                {pooled.wins} of {pooled.n} · range {pct(pooled.ci[0])}–{pct(pooled.ci[1])} ·
                break-even {pct(pooled.breakEven)}
              </small>
              <CiBar stats={pooled} />
            </>
          ) : (
            <small>{runText(run, statsError)}</small>
          )}
        </div>
        <div>
          <span className={styles.lbl}>Average result after costs</span>
          {pooled ? (
            <>
              <span
                className={`${styles.num} ${pooled.expectancyR >= 0 ? styles.up : styles.down}`}
              >
                {signedR(pooled.expectancyR)}
              </span>
              <small>a trade · costs {signedR(-pooled.avgCostR)} included</small>
            </>
          ) : (
            <small>—</small>
          )}
        </div>
      </div>

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
          <dt>Target</dt>
          <dd className={styles.up}>{price(o.target)}</dd>
        </div>
        <div>
          <dt>Reward : risk</dt>
          <dd>{rr.toFixed(2)}R</dd>
        </div>
      </dl>
      <p className={styles.note}>
        Holds up to {maxHoldBars} candles or the pattern&apos;s length.
        {!isCurrent && ` This past case: ${resultLabel}.`}
      </p>

      {cases.length > 0 && (
        <>
          <h3 className={styles.sub}>Last {cases.length} cases (all coins)</h3>
          <div className={styles.outcomes} aria-hidden="true">
            {cases.map((c) => (
              <span
                key={`${c.symbol}${c.time}`}
                className={c.result === "win" ? styles.w : c.result === "loss" ? styles.l : ""}
              >
                {RESULT_MARK[c.result].mark}
              </span>
            ))}
          </div>
          <table className={styles.tbl}>
            <caption className="sr-only">Most recent resolved cases of this pattern</caption>
            <tbody>
              {cases.map((c) => (
                <tr key={`${c.symbol}${c.time}`}>
                  <td className={styles.mute}>{shortDate(c.time)}</td>
                  <td>{c.symbol}</td>
                  <td className={styles.mute}>{RESULT_MARK[c.result].label}</td>
                  <td className={`${styles.r} ${c.movePct >= 0 ? styles.up : styles.down}`}>
                    {signedPct(c.movePct)}
                  </td>
                  <td className={`${styles.r} ${styles.mute}`}>{c.bars} bars</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <div className={styles.actions}>
        <Link
          className={styles.btn}
          to={`/risk?${new URLSearchParams({
            symbol: o.symbol,
            setup: key,
            tf: interval,
            zoneTf,
            entry: String(Number(o.entry.toPrecision(8))),
            stop: String(Number(o.stop.toPrecision(8))),
            target: String(Number(o.target.toPrecision(8))),
          }).toString()}`}
        >
          Size this trade
        </Link>
        <Link
          className={styles.btn}
          to={`/alerts?${new URLSearchParams({ symbol: o.symbol, setup: key, tf: interval }).toString()}`}
        >
          Alert me next time
        </Link>
      </div>

      <p className={styles.note}>
        Pattern history after estimated costs
        {run?.costs
          ? ` (${run.costs.feePct}% fee + ${run.costs.slippagePct}% slippage a side, and the funding paid)`
          : ""}
        . In-sample: it becomes a confirmation only after an out-of-sample backtest (Phase 2) and a
        forward test (Phase 4).
      </p>
    </section>
  );
};

export default SetupCard;
