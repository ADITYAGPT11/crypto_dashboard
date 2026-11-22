import { Link } from "react-router-dom";
import type { CandleInterval } from "../../types/marketData";
import type { SetupOccurrence } from "../../types/analysis";
import { Explain } from "../../common-components/Evidence";
import type { PatternGroup } from "../../utils/patternGroups";
import { patternLabel } from "../../utils/patternLabels";
import { setupKey } from "../../utils/setupKeys";
import { shortDate } from "../../utils/format";
import { TfBadge } from "./TfBadge";
import styles from "./ChartPage.module.scss";

/** A detection on the chart: the occurrence plus the timeframe it was found on. */
export interface Found {
  occ: SetupOccurrence;
  pattern: string;
  direction: SetupOccurrence["direction"];
  tf: CandleInterval;
  zoneTf: CandleInterval;
  /** Close time of the confirmation candle (when the pattern existed). */
  closeTime: number;
}

interface Props {
  symbol: string;
  groups: PatternGroup<Found>[];
  /** Open row (`pattern|direction`); its newest detection is the one drawn. */
  openId: string | null;
  onOpen: (g: PatternGroup<Found>) => void;
  isNow: (f: Found) => boolean;
  ruleset: string | null;
  loading: boolean;
  /** Empty-state text when nothing is listed and nothing is loading. */
  empty: string;
}

function whenText(f: Found, now: boolean) {
  return now ? "Now" : shortDate(f.closeTime - 1);
}

/** The setup checklist of the newest detection: what passed, what was observed. */
function Checklist({ f, now }: { f: Found; now: boolean }) {
  const o = f.occ;
  const key = setupKey(o.pattern, o.direction, "*");
  return (
    <div className={styles.checkPanel}>
      <ul className={styles.checks} aria-label="Setup checklist">
        {o.checks.map((c) => (
          <li key={c.id} className={c.passed ? styles.checkOk : styles.checkNo}>
            <span aria-hidden="true">{c.passed ? "✓" : "✗"}</span>
            <span className="sr-only">{c.passed ? "Passed: " : "Not passed: "}</span>
            <b>{c.label}</b>
            <span className={styles.mute}>{c.detail}</span>
          </li>
        ))}
      </ul>
      <p className={styles.note}>
        {now ? "Found on a recent candle" : `Found ${shortDate(f.closeTime - 1)}`} on {f.tf} ·{" "}
        {o.score} of {o.checks.length} checks. A checklist of where and how the pattern formed, not
        a probability: you decide the trade.
      </p>
      <div className={styles.actions}>
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

/** Patterns on this chart: one row each with its checklist score; the open one lists the checks. */
const PatternRows: React.FC<Props> = (p) => (
  <section className={styles.card} aria-labelledby="rows-title">
    <div className={styles.rowsHead}>
      <h2 id="rows-title">Patterns on this chart · {p.symbol}</h2>
      <span className={styles.lbl}>
        Checks met at the confirmation candle · open a row for the list{" "}
        <Explain title="How the checklist works">
          Six yes/no checks on where and how each pattern formed, read at its confirmation candle:
          at a bullish order block or demand zone (bearish block or supply zone for shorts); RSI(14)
          between 50 and 70 (30–50 for shorts; beyond is stretched); volume at least 1.5× the
          20-candle average; close above VWAP(20) (below for shorts); ATR(14) at or above its
          50-candle average; Supertrend(10, 3) pointing the pattern&apos;s way. The score counts the
          checks met. It describes the context; it is not measured against outcomes and is not a
          prediction{p.ruleset ? ` (rules ${p.ruleset})` : ""}.
        </Explain>
      </span>
    </div>
    <ul className={styles.rows}>
      {p.groups.map((g) => {
        const open = g.id === p.openId;
        const f = g.latest;
        const now = p.isNow(f);
        const long = g.direction === "long";
        const panel = `row-${g.id.replace(/[^a-z0-9]/gi, "-")}`;
        return (
          <li key={g.id} className={open ? styles.rowOpen : undefined}>
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
              </b>
              <span className={styles.rowWhere}>
                <TfBadge tf={f.tf} /> {whenText(f, now)}
              </span>
              <span
                className={styles.num}
                title={`${f.occ.score} of ${f.occ.checks.length} checks met`}
              >
                {f.occ.score}/{f.occ.checks.length}
              </span>
            </button>
            {open && (
              <div id={panel} className={styles.rowBody}>
                <Checklist f={f} now={now} />
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

export default PatternRows;
