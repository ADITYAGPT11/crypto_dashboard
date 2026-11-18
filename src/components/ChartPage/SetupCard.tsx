import type { ContextSummaryOut, RunOut } from "../../api/schema";
import type { SetupCase, SetupOccurrence, SetupStats } from "../../types/analysis";
import { CiBar, Explain, VerdictChip } from "../../common-components/Evidence";
import { Link } from "react-router-dom";
import { TfBadge } from "./TfBadge";
import { patternLabel } from "../../utils/patternLabels";
import { locationLabel, setupKey } from "../../utils/setupKeys";
import { pct, price, shortDate, signedPct, signedR } from "../../utils/format";
import {
  byContext,
  compare,
  contextLabel,
  contextsOf,
  FLOW_CONTEXTS,
  flowText,
} from "../../utils/flowContext";
import styles from "./ChartPage.module.scss";

export interface Check {
  ok: boolean;
  text: string;
}

interface Props {
  occurrence: SetupOccurrence;
  /** Timeframe the pattern was detected on, and where its levels came from. */
  interval: string;
  zoneTf: string;
  isCurrent: boolean;
  /** This setup across every coin (background statistics). */
  pooled: SetupStats | null;
  /** The same pattern at any location: does the location add anything? */
  baseline: SetupStats | null;
  own: SetupStats | null;
  /** This setup's pooled record split by order flow at confirmation. */
  contexts: ContextSummaryOut[];
  recent: SetupCase[];
  run: RunOut | null;
  statsError: string | null;
  ruleset: string | null;
  maxHoldBars: number;
  minSample: number;
  checks: Check[];
}

function runText(run: RunOut | null, error: string | null): string {
  if (error) return error;
  if (!run)
    return "Statistics not measured yet: the background job starts with the analysis service.";
  if (run.status === "running")
    return `Measuring in the background: ${run.done}/${run.coins.length} coins…`;
  if (run.status === "failed") return "The last statistics run failed; it retries within the hour.";
  return "No past cases of this setup yet.";
}

const SetupCard: React.FC<Props> = ({
  occurrence: o,
  interval,
  zoneTf,
  isCurrent,
  pooled,
  baseline,
  own,
  contexts,
  recent,
  run,
  statsError,
  ruleset,
  maxHoldBars,
  minSample,
  checks,
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
          ? "Expired"
          : "Still open";
  const coins = run?.coins.length ?? 0;
  const years = run ? Math.round((run.days / 365) * 10) / 10 : null;
  const key = setupKey(o.pattern, o.direction, o.location);
  const flowNow = new Set(contextsOf(o.flow));
  const flowRows = byContext(contexts);

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
            {patternLabel(o.pattern)}{" "}
            <span className={styles.mute}>
              {locationLabel(o.location, o.direction)}
              {o.location !== "openSpace" && (
                <>
                  {" "}
                  (<TfBadge tf={zoneTf} />)
                </>
              )}
            </span>
          </h2>
        </div>
        {pooled && <VerdictChip verdict={pooled.verdict} />}
      </div>

      <div className={styles.big}>
        <div>
          <span className={styles.lbl}>
            Win rate · {coins} coins{years ? ` · ${years} y` : ""}{" "}
            <Explain title="How win rate is measured">
              A case wins when the target is hit before the stop within {maxHoldBars} candles (a
              candle touching both counts as a loss). Every past case of this exact setup (pattern,
              direction, location, timeframes) across the research coins is counted by the same
              rules that drew it here. The range is the 95% Wilson interval; the amber tick is the
              break-even win rate for this setup's average win size. Edge candidate means the whole
              range sits above break-even, with at least {minSample} cases.
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
          <span className={styles.lbl}>Same pattern, any location</span>
          {baseline ? (
            <>
              <span className={styles.num}>{pct(baseline.winRate)}</span>
              <small>
                {baseline.wins} of {baseline.n} · range {pct(baseline.ci[0])}–{pct(baseline.ci[1])}
              </small>
            </>
          ) : (
            <small>—</small>
          )}
        </div>
        <div>
          <span className={styles.lbl}>This coin only</span>
          {own ? (
            <>
              <span className={styles.num}>
                {own.wins} / {own.n}
              </span>
              <small>
                range {pct(own.ci[0])}–{pct(own.ci[1])}
                {own.n < minSample ? " · too few alone" : ""}
              </small>
            </>
          ) : (
            <small>No resolved cases</small>
          )}
        </div>
        <div>
          <span className={styles.lbl}>Expectancy after costs</span>
          {pooled ? (
            <>
              <span
                className={`${styles.num} ${pooled.expectancyR >= 0 ? styles.up : styles.down}`}
              >
                {signedR(pooled.expectancyR)}
              </span>
              <small>
                gross {signedR(pooled.expectancyGrossR)} · costs {signedR(-pooled.avgCostR)} a trade
                · avg win {signedPct(pooled.avgWinPct)} · loss {signedPct(pooled.avgLossPct)} ·
                median {pooled.medianBars} candles
              </small>
            </>
          ) : (
            <small>—</small>
          )}
        </div>
        <div>
          <span className={styles.lbl}>
            Trailing TP after costs{" "}
            <Explain title="Trailing take-profit">
              The same cases managed differently: at the target the trade is not closed; the stop
              then follows the best price by 0.5 ATR until it is hit (or 120 candles pass). Every
              closed case counts, after fees, slippage and the funding paid while it was open. Range
              = 95% range of the mean.
            </Explain>
          </span>
          {pooled?.trail && pooled.trail.n > 0 ? (
            <>
              <span
                className={`${styles.num} ${(pooled.trail.expectancyNetR ?? pooled.trail.expectancyR) >= 0 ? styles.up : styles.down}`}
              >
                {signedR(pooled.trail.expectancyNetR ?? pooled.trail.expectancyR)}
              </span>
              <small>
                {pooled.trail.expLow !== null && pooled.trail.expHigh !== null
                  ? `range ${signedR(pooled.trail.expLow)} to ${signedR(pooled.trail.expHigh)} · `
                  : ""}
                gross {signedR(pooled.trail.expectancyR)} · {pct(pooled.trail.winRate)} closed in
                profit · n {pooled.trail.n}
              </small>
            </>
          ) : (
            <small>Not measured yet</small>
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
      {!isCurrent && <p className={styles.note}>This past case: {resultLabel}.</p>}

      <h3 className={styles.sub}>
        Confluence{" "}
        <Explain title="Confluence">
          Independent reasons agreeing. Location (zone / order block) is part of the measured setup;
          volume, trend (EMA 50) and the point of control are context shown here, not measured.
        </Explain>
      </h3>
      <ul className={styles.checks}>
        {checks.map((c) => (
          <li key={c.text}>
            <span className={c.ok ? styles.mkOk : styles.mkWarn} aria-hidden="true">
              {c.ok ? "✓" : "!"}
            </span>
            <span>
              <span className="sr-only">{c.ok ? "Yes: " : "Caution: "}</span>
              {c.text}
            </span>
          </li>
        ))}
      </ul>

      <h3 className={styles.sub}>
        Order flow{" "}
        <Explain title="Order flow at the setup">
          Aggressive buying minus aggressive selling (Binance taker volume) when the pattern
          confirmed. Delta "with the setup" means the last 3 candles leaned at least 2% of volume
          the trade's way; CVD divergence means price made a lower low (higher high for shorts)
          while cumulative delta did not. Each row is this setup's past cases in that situation. A
          row is marked better or worse only when its whole 95% range sits on one side of the
          setup's overall win rate; with many rows compared, treat even that as a lead to test, not
          an edge.
        </Explain>
      </h3>
      <p className={styles.note}>
        Now: {flowText(o.flow)}
        {o.flow.cvdDivergence !== null &&
          ` · ${o.flow.cvdDivergence ? "CVD divergence" : "no CVD divergence"}`}
        .
      </p>
      {flowRows.size > 0 ? (
        <table className={styles.tbl}>
          <caption className="sr-only">
            Win rate of this setup by order flow at confirmation
          </caption>
          <tbody>
            {FLOW_CONTEXTS.filter((c) => flowRows.has(c)).map((c) => {
              const s = flowRows.get(c)!;
              const cmp = compare(s, pooled?.winRate ?? null, minSample);
              return (
                <tr key={c} className={flowNow.has(c) ? styles.rowNow : undefined}>
                  <td>
                    {contextLabel(c)}
                    {flowNow.has(c) && <span className={styles.mute}> · now</span>}
                  </td>
                  <td className={styles.r}>
                    {pct(s.winRate)}
                    <small className={styles.cellSub}>
                      {pct(s.ciLow)}–{pct(s.ciHigh)}
                    </small>
                  </td>
                  <td
                    className={`${styles.r} ${cmp === "better" ? styles.up : cmp === "worse" ? styles.down : styles.mute}`}
                  >
                    n {s.n}
                    <small className={styles.cellSub}>
                      {cmp === "better"
                        ? "better"
                        : cmp === "worse"
                          ? "worse"
                          : cmp === "tooFew"
                            ? "too few"
                            : "no clear diff."}
                    </small>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <p className={styles.note}>
          No order-flow record for this setup yet (measured by the background job).
        </p>
      )}

      {recent.length > 0 && (
        <>
          <h3 className={styles.sub}>Last {Math.min(recent.length, 8)} cases (all coins)</h3>
          <div className={styles.outcomes} aria-hidden="true">
            {recent.slice(0, 8).map((c) => (
              <span
                key={`${c.symbol}${c.time}`}
                className={c.result === "win" ? styles.w : styles.l}
              >
                {c.result === "win" ? "W" : "L"}
              </span>
            ))}
          </div>
          <table className={styles.tbl}>
            <caption className="sr-only">Most recent resolved cases of this setup</caption>
            <tbody>
              {recent.slice(0, 8).map((c) => (
                <tr key={`${c.symbol}${c.time}`}>
                  <td className={styles.mute}>{shortDate(c.time)}</td>
                  <td>{c.symbol}</td>
                  <td className={`${styles.r} ${c.result === "win" ? styles.up : styles.down}`}>
                    {signedPct(c.movePct)}
                  </td>
                  <td className={`${styles.r} ${styles.mute}`}>{c.bars} bars</td>
                  <td
                    className={`${styles.r} ${(c.trailNetR ?? 0) > 0 ? styles.up : styles.down}`}
                    title="Trailing take-profit result after costs"
                  >
                    {c.trailNetR === null || c.trailNetR === undefined
                      ? ""
                      : `trail ${signedR(c.trailNetR)}`}
                  </td>
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
