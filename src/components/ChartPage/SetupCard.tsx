import type { SetupOccurrence, SetupStats } from "../../types/analysis";
import { CiBar, Explain, VerdictChip } from "../../common-components/Evidence";
import { PATTERN_LABELS } from "../../utils/patterns";
import { Link } from "react-router-dom";
import { LOCATION_LABELS, MAX_HOLD_BARS, MIN_SAMPLE, setupKey } from "../../utils/setupAnalysis";
import { pct, price, shortDate, signedPct, signedR } from "../../utils/format";
import styles from "./ChartPage.module.scss";

export interface Check {
  ok: boolean;
  text: string;
}

interface Props {
  occurrence: SetupOccurrence;
  interval: string;
  isCurrent: boolean;
  pooled: SetupStats | null;
  own: SetupStats | null;
  coins: number;
  pooling: boolean;
  checks: Check[];
}

const SetupCard: React.FC<Props> = ({
  occurrence,
  interval,
  isCurrent,
  pooled,
  own,
  coins,
  pooling,
  checks,
}) => {
  const { hit, location, outcome } = occurrence;
  const rr = (hit.target - hit.entry) / (hit.entry - hit.stop);
  const resultLabel =
    outcome.result === "win"
      ? `Won ${signedPct(outcome.movePct)}`
      : outcome.result === "loss"
        ? `Lost ${signedPct(outcome.movePct)}`
        : outcome.result === "expired"
          ? "Expired"
          : "Still open";

  return (
    <section className={`${styles.card} ${styles.feature}`} aria-labelledby="setup-title">
      <div className={styles.setupHead}>
        <div>
          <span className={styles.lbl}>
            {isCurrent ? "Setup on a recent candle" : `Setup on ${shortDate(occurrence.time)}`} ·{" "}
            {interval}
          </span>
          <h2 id="setup-title">
            {PATTERN_LABELS[hit.type]}{" "}
            <span className={styles.mute}>{LOCATION_LABELS[location]}</span>
          </h2>
        </div>
        {pooled && <VerdictChip verdict={pooled.verdict} />}
      </div>

      <div className={styles.big}>
        <div>
          <span className={styles.lbl}>
            Win rate · {coins} coins{" "}
            <Explain title="How win rate is measured">
              A case wins when the target is hit before the stop within {MAX_HOLD_BARS} candles (a
              candle touching both counts as a loss). The range is the 95% Wilson interval: where
              the true rate plausibly lies. The amber tick is the break-even win rate for this
              setup's average win size. Edge candidate means the whole range sits above break-even,
              with at least {MIN_SAMPLE} cases.
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
            <small>{pooling ? `Pooling across ${coins} coins…` : "No pooled cases yet"}</small>
          )}
        </div>
        <div>
          <span className={styles.lbl}>Avg move</span>
          {pooled ? (
            <>
              <span className={`${styles.num} ${styles.up}`}>{signedPct(pooled.avgWinPct)}</span>
              <small>on wins · losses {signedPct(pooled.avgLossPct)}</small>
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
                {own.n < MIN_SAMPLE ? " · too few alone" : ""}
              </small>
            </>
          ) : (
            <small>No resolved cases</small>
          )}
        </div>
        <div>
          <span className={styles.lbl}>Expectancy (gross)</span>
          {pooled ? (
            <>
              <span
                className={`${styles.num} ${pooled.expectancyR >= 0 ? styles.up : styles.down}`}
              >
                {signedR(pooled.expectancyR)}
              </span>
              <small>median {pooled.medianBars} candles to result</small>
            </>
          ) : (
            <small>—</small>
          )}
        </div>
      </div>

      <dl className={styles.plan}>
        <div>
          <dt>Entry</dt>
          <dd>{price(hit.entry)}</dd>
        </div>
        <div>
          <dt>Stop</dt>
          <dd className={styles.down}>{price(hit.stop)}</dd>
        </div>
        <div>
          <dt>Target</dt>
          <dd className={styles.up}>{price(hit.target)}</dd>
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
          Independent reasons agreeing: location (demand zone), volume on the confirmation candle,
          trend (EMA 50) and where most volume traded (point of control). Location is measured
          separately in the statistics; the other checks are context.
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

      {pooled && pooled.recent.length > 0 && (
        <>
          <h3 className={styles.sub}>Last {pooled.recent.length} cases (all coins)</h3>
          <div className={styles.outcomes} aria-hidden="true">
            {pooled.recent.map((o) => (
              <span
                key={`${o.symbol}${o.time}`}
                className={o.outcome.result === "win" ? styles.w : styles.l}
              >
                {o.outcome.result === "win" ? "W" : "L"}
              </span>
            ))}
          </div>
          <table className={styles.tbl}>
            <caption className="sr-only">Most recent resolved cases of this setup</caption>
            <tbody>
              {pooled.recent.map((o) => (
                <tr key={`${o.symbol}${o.time}`}>
                  <td className={styles.mute}>{shortDate(o.time)}</td>
                  <td>{o.symbol}</td>
                  <td
                    className={`${styles.r} ${o.outcome.result === "win" ? styles.up : styles.down}`}
                  >
                    {signedPct(o.outcome.movePct)}
                  </td>
                  <td className={`${styles.r} ${styles.mute}`}>{o.outcome.bars} bars</td>
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
            symbol: occurrence.symbol,
            setup: setupKey(hit.type, location),
            tf: interval,
            entry: String(Number(hit.entry.toPrecision(8))),
            stop: String(Number(hit.stop.toPrecision(8))),
            target: String(Number(hit.target.toPrecision(8))),
          }).toString()}`}
        >
          Size this trade
        </Link>
        <Link
          className={styles.btn}
          to={`/alerts?${new URLSearchParams({
            symbol: occurrence.symbol,
            setup: setupKey(hit.type, location),
            tf: interval,
          }).toString()}`}
        >
          Alert me next time
        </Link>
      </div>

      <p className={styles.note}>
        Pattern history before fees and slippage. It becomes a confirmation only after a costed,
        out-of-sample backtest (Phase 2) and a forward test (Phase 4).
      </p>
    </section>
  );
};

export default SetupCard;
