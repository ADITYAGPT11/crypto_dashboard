import { Link } from "react-router-dom";
import type { CandleInterval } from "../../types/marketData";
import type { SetupCheck, SetupOccurrence } from "../../types/analysis";
import { Explain } from "../../common-components/Evidence";
import { LIST_SIZE, MIN_CHECKS, type Grouped } from "../../utils/patternList";
import { patternLabel } from "../../utils/patternLabels";
import { setupKey } from "../../utils/setupKeys";
import { monthDay } from "../../utils/format";
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
  /** The listed rows, newest first: one per breakout, other patterns on it in `also`. */
  items: Grouped<Found>[];
  idOf: (f: Found) => string;
  /** Selected row; its detection is the one drawn. */
  openId: string | null;
  onOpen: (f: Found) => void;
  isNow: (f: Found) => boolean;
  ruleset: string | null;
  loading: boolean;
  /** Empty-state text when nothing is listed and nothing is loading. */
  empty: string;
}

/** Short tag per check, in checklist order. */
const TAG: Record<SetupCheck["id"], string> = {
  location: "OB",
  rsi: "RSI",
  volume: "VOL",
  vwap: "VWAP",
  atr: "ATR",
  supertrend: "ST",
};

/** When the confirmation candle closed: date and time, or just the date for daily candles. */
function whenText(f: Found, now: boolean) {
  if (now) return "Now";
  return f.tf === "1d" ? monthDay(f.closeTime - 1) : monthDay(f.closeTime, true);
}

/** The six checks as small tags: green when met, struck through when not; hover for detail. */
function CheckTags({ checks, volume }: { checks: SetupCheck[]; volume?: string | null }) {
  return (
    <span className={styles.tags}>
      {checks.map((c) => (
        <span
          key={c.id}
          className={c.passed ? styles.tagYes : styles.tagNo}
          title={`${c.passed ? "✓" : "✗"} ${c.label}: ${c.detail}`}
        >
          {TAG[c.id]}
          <span className="sr-only">{c.passed ? " met" : " not met"}</span>
        </span>
      ))}
      {volume === "falling" ? (
        <span
          className={styles.tagInfo}
          title="Volume fell while the pattern formed, as textbooks expect for flags, triangles and wedges. Information only: not one of the six checks."
        >
          VOL↓
        </span>
      ) : (
        // Keeps every row's columns lined up whether or not it has the tag.
        <span className={`${styles.tagInfo} ${styles.tagSlot}`} aria-hidden="true">
          VOL↓
        </span>
      )}
    </span>
  );
}

/**
 * The last patterns on this chart meeting the minimum checks, in two columns, each row with its
 * six checks inline. Clicking a row draws it on the chart.
 */
const PatternRows: React.FC<Props> = (p) => {
  const sel = p.items.find((f) => p.idOf(f) === p.openId) ?? null;
  return (
    <section className={styles.card} aria-labelledby="rows-title">
      <div className={styles.rowsHead}>
        <h2 id="rows-title">
          Last {LIST_SIZE} patterns · {p.symbol}
        </h2>
        <span className={styles.lbl}>
          {MIN_CHECKS}+ of 6 checks · OB zone / order block · RSI · VOL · VWAP · ATR · ST Supertrend{" "}
          <Explain title="How the checklist works">
            Six yes/no checks on where and how each pattern formed, read at its confirmation candle:
            at a bullish order block or demand zone (bearish block or supply zone for shorts);
            RSI(14) between 50 and 70 (30–50 for shorts; beyond is stretched); volume at least 1.5×
            the 20-candle average; close above VWAP(20) (below for shorts); ATR(14) at or above its
            50-candle average; Supertrend(10, 3) pointing the pattern&apos;s way. Hover a tag for
            what was observed. VOL↓ (not a check) marks a flag, triangle or wedge whose volume fell
            while it formed. Patterns confirmed on the same candle share one row. The score counts
            the checks met. It describes the context; it is not measured against outcomes and is not
            a prediction
            {p.ruleset ? ` (rules ${p.ruleset})` : ""}.
          </Explain>
        </span>
      </div>
      {/* Newest first down the left column, then the right one. */}
      <ul
        className={styles.rows}
        style={{ "--rows": Math.max(1, Math.ceil(p.items.length / 2)) } as React.CSSProperties}
      >
        {p.items.map((f) => {
          const id = p.idOf(f);
          const open = id === p.openId;
          const long = f.direction === "long";
          return (
            <li key={id} className={open ? styles.rowOpen : undefined}>
              <button
                type="button"
                className={styles.rowBtn}
                aria-pressed={open}
                onClick={() => p.onOpen(f)}
              >
                <b>
                  <span className={long ? styles.up : styles.down}>
                    {long ? "▲" : "▼"}
                    <span className="sr-only">{long ? " Long" : " Short"}</span>
                  </span>{" "}
                  {patternLabel(f.pattern)}
                  {f.also.length > 0 && (
                    <span
                      className={styles.also}
                      title="Confirmed on the same candle: one breakout, several pattern names"
                    >
                      {" + "}
                      {f.also.map((a) => patternLabel(a.pattern)).join(" + ")}
                    </span>
                  )}
                </b>
                <TfBadge tf={f.tf} />
                <span className={styles.rowWhen}>{whenText(f, p.isNow(f))}</span>
                <CheckTags checks={f.occ.checks} volume={f.occ.formationVolume} />
                <span
                  className={styles.num}
                  title={`${f.occ.score} of ${f.occ.checks.length} checks met`}
                >
                  {f.occ.score}/{f.occ.checks.length}
                </span>
              </button>
            </li>
          );
        })}
        {!p.loading && p.items.length === 0 && <li className={styles.rowEmpty}>{p.empty}</li>}
        {p.loading && p.items.length === 0 && (
          <li className={styles.rowEmpty}>Detecting patterns…</li>
        )}
      </ul>
      {sel && (
        <div className={styles.rowFoot}>
          <span>
            Drawn: <b>{patternLabel(sel.pattern)}</b> on {sel.tf}, {sel.occ.score} of{" "}
            {sel.occ.checks.length} checks
            {sel.also.length > 0 &&
              ` (same breakout as ${sel.also.map((a) => patternLabel(a.pattern)).join(", ")})`}
            . A checklist of where it formed, not a probability: you decide the trade.
          </span>
          <Link
            className={styles.btn}
            to={`/alerts?${new URLSearchParams({
              symbol: sel.occ.symbol,
              setup: setupKey(sel.occ.pattern, sel.occ.direction, "*"),
              tf: sel.tf,
            }).toString()}`}
          >
            Alert me
          </Link>
        </div>
      )}
    </section>
  );
};

export default PatternRows;
