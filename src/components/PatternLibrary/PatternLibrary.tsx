import { useMemo } from "react";
import type { LibraryEntry } from "../../services/PatternLibraryService";
import type {
  LibraryEvent,
  LibraryKind,
  LibraryPatternStats,
  LibraryStats,
} from "../../types/patternLibrary";
import { Chip, CiBar, Explain, VerdictChip } from "../../common-components/Evidence";
import { pct, price, shortDate, signedPct, signedR } from "../../utils/format";
import {
  eventId,
  indexStats,
  LIBRARY_KIND_LABELS,
  listEvents,
  statsKey,
  toCiStats,
} from "../../utils/patternLibrary";
import styles from "./PatternLibrary.module.scss";

const KINDS: LibraryKind[] = ["chart", "short", "candlestick"];
const LIST_LIMIT = 12;

interface Props {
  symbol: string;
  interval: string;
  kind: LibraryKind;
  onKind: (kind: LibraryKind) => void;
  entry: LibraryEntry | null;
  onRetry: () => void;
  selected: LibraryEvent | null;
  onSelect: (event: LibraryEvent | null) => void;
}

type CardProps = Pick<Props, "symbol" | "interval" | "entry" | "onSelect"> & {
  selected: LibraryEvent;
};

function resultText(e: LibraryEvent): string {
  const o = e.outcome;
  if (o.result === "win") return `Won ${signedPct(o.move_pct)}`;
  if (o.result === "loss") return `Lost ${signedPct(o.move_pct)}`;
  if (o.result === "expired") return "Expired";
  return "Still open";
}

function DirectionChip({ e }: { e: Pick<LibraryEvent, "direction"> }) {
  return e.direction === "bullish" ? <Chip tone="up">Long</Chip> : <Chip tone="down">Short</Chip>;
}

function StatBlock({ title, s }: { title: string; s: LibraryStats }) {
  return (
    <div className={styles.block}>
      <span className={styles.lbl}>{title}</span>
      {s.n > 0 ? (
        <>
          <span className={`${styles.num} ${s.verdict === "edge" ? styles.up : ""}`}>
            {pct(s.win_rate)}
          </span>
          <small>
            {s.wins} of {s.n} · range {pct(s.ci_low)}–{pct(s.ci_high)}
          </small>
          <CiBar stats={toCiStats(s)} />
          <small>
            Expectancy {signedR(s.expectancy_r)} · avg win {signedPct(s.avg_win_pct)} · avg loss{" "}
            {signedPct(s.avg_loss_pct)}
          </small>
        </>
      ) : (
        <small>No resolved cases</small>
      )}
    </div>
  );
}

const PatternLibrary: React.FC<Props> = ({
  symbol,
  interval,
  kind,
  onKind,
  entry,
  onRetry,
  selected,
  onSelect,
}) => {
  const byKey = useMemo(() => indexStats(entry?.stats?.stats ?? []), [entry]);
  const rows = useMemo(
    () =>
      entry?.patterns ? listEvents(entry.patterns.current, entry.patterns.events, LIST_LIMIT) : [],
    [entry],
  );
  const bracket = entry?.patterns?.bracket ?? entry?.stats?.bracket ?? null;
  const coins = entry?.stats?.symbols.length ?? 0;

  return (
    <section className={styles.card} aria-labelledby="lib-title">
      <div className={styles.head}>
        <h2 id="lib-title">Pattern library</h2>
        <Explain title="Pattern library">
          Detectors from ta_patterns (MIT), run by the Python backend on closed {interval} candles;
          a pattern counts on the candle that completes it, using only candles that existed then.
          Every past case is judged by the same rule
          {bracket
            ? `: entry at that close, stop ${bracket.stop_atr} ATR, target ${bracket.target_atr} ATR, ${bracket.max_bars} candles to resolve`
            : ""}
          . A candle touching both counts as a loss. The verdict needs the low end of the range,
          corrected for how many patterns were tested, above break-even.
        </Explain>
        <p>
          {LIBRARY_KIND_LABELS[kind]} on {symbol} {interval}, newest first, with how each did before
          {coins ? ` on ${coins} coins` : ""}.
        </p>
        <span className={styles.toggles} role="group" aria-label="Pattern kind">
          {KINDS.map((k) => (
            <button
              key={k}
              type="button"
              className={styles.tog}
              aria-pressed={k === kind}
              onClick={() => onKind(k)}
            >
              {LIBRARY_KIND_LABELS[k]}
            </button>
          ))}
        </span>
      </div>

      {entry?.status === "offline" && (
        <div className={styles.state} role="status">
          <span>
            The Python backend isn't reachable. Start it with <code>npm run backend:py</code> next
            to <code>npm run dev</code>.
          </span>
          <button type="button" className={styles.btn} onClick={onRetry}>
            Try again
          </button>
        </div>
      )}
      {entry?.status === "error" && (
        <div className={styles.state} role="alert">
          <span>Couldn't load patterns: {entry.error}</span>
          <button type="button" className={styles.btn} onClick={onRetry}>
            Try again
          </button>
        </div>
      )}
      {(!entry || (entry.status === "loading" && !entry.patterns)) && (
        <p className={styles.mute} role="status">
          Scanning {symbol} and pooling the research coins… the first load takes about 10 seconds.
        </p>
      )}

      {entry?.patterns && (
        <ul className={styles.list}>
          {rows.map(({ event: e, isNow }) => {
            const st = byKey.get(statsKey(e.pattern, e.direction))?.pooled;
            const id = eventId(e);
            return (
              <li key={id}>
                <button
                  type="button"
                  aria-pressed={selected !== null && eventId(selected) === id}
                  onClick={() => onSelect(selected && eventId(selected) === id ? null : e)}
                >
                  <b>
                    <DirectionChip e={e} /> {e.label}
                  </b>
                  <span className={styles.num}>{st && st.n > 0 ? pct(st.win_rate) : "–"}</span>
                  <small>
                    {isNow ? "Now" : shortDate(e.open_time)} ·{" "}
                    {st ? `${st.n} past cases` : "no stats"}
                    {st && st.n > 0 && st.verdict === "edge" ? " · edge candidate" : ""}
                  </small>
                </button>
              </li>
            );
          })}
          {rows.length === 0 && (
            <li className={styles.mute}>No {LIBRARY_KIND_LABELS[kind].toLowerCase()} found.</li>
          )}
        </ul>
      )}
      {entry?.stats && entry.stats.unavailable.length > 0 && (
        <p className={styles.note}>
          Pooled without {entry.stats.unavailable.join(", ")} (history failed to load).
        </p>
      )}
    </section>
  );
};

/** The picked pattern: its plan, how it did before (pooled and this coin), past cases. */
export const PatternLibraryCard: React.FC<CardProps> = ({
  symbol,
  interval,
  entry,
  selected,
  onSelect,
}) => {
  const byKey = useMemo(() => indexStats(entry?.stats?.stats ?? []), [entry]);
  const coins = entry?.stats?.symbols.length ?? 0;
  const sel: LibraryPatternStats | null =
    byKey.get(statsKey(selected.pattern, selected.direction)) ?? null;
  const nowIds = new Set(entry?.patterns?.current.map(eventId) ?? []);
  return (
    <section className={`${styles.card} ${styles.feature}`} aria-labelledby="lib-sel-title">
      <div className={styles.selHead}>
        <div>
          <span className={styles.lbl}>
            {nowIds.has(eventId(selected))
              ? "On a recent candle"
              : `Completed ${shortDate(selected.open_time)}`}{" "}
            · {symbol} {interval} · ta_patterns
          </span>
          <h2 id="lib-sel-title">
            <DirectionChip e={selected} /> {selected.label}
          </h2>
        </div>
        {sel && <VerdictChip verdict={sel.pooled.verdict} />}
      </div>

      <dl className={styles.plan}>
        <div>
          <dt>Entry</dt>
          <dd>{price(selected.entry)}</dd>
        </div>
        <div>
          <dt>Stop</dt>
          <dd className={styles.down}>{price(selected.stop)}</dd>
        </div>
        <div>
          <dt>Target</dt>
          <dd className={styles.up}>{price(selected.target)}</dd>
        </div>
        <div>
          <dt>Result</dt>
          <dd>{resultText(selected)}</dd>
        </div>
      </dl>

      {sel ? (
        <>
          <div className={styles.blocks}>
            <StatBlock title={`Pooled · ${coins} coins`} s={sel.pooled} />
            <StatBlock title="This coin only" s={sel.own} />
          </div>
          <p className={styles.small}>
            Break-even {pct(sel.pooled.break_even)} at this bracket. Verdict uses the range
            corrected for {sel.pooled.tests} patterns tested (low end{" "}
            {pct(sel.pooled.ci_low_adjusted)}); {sel.pooled.expired} expired and {sel.pooled.open}{" "}
            still open are left out of the win rate. Gross, before fees.
          </p>

          <div className={styles.detail}>
            <div className={styles.xs}>
              <table className={styles.tbl}>
                <caption className={styles.lbl}>Move after the pattern (pooled)</caption>
                <thead>
                  <tr>
                    <th>After</th>
                    <th className={styles.r}>Cases</th>
                    <th className={styles.r}>Mean</th>
                    <th className={styles.r}>Median</th>
                    <th className={styles.r}>In favour</th>
                  </tr>
                </thead>
                <tbody>
                  {sel.pooled.forward.map((f) => (
                    <tr key={f.horizon}>
                      <td>{f.horizon} candles</td>
                      <td className={`${styles.r} ${styles.num}`}>{f.n}</td>
                      <td className={`${styles.r} ${styles.num}`}>{signedPct(f.mean_pct, 2)}</td>
                      <td className={`${styles.r} ${styles.num}`}>{signedPct(f.median_pct, 2)}</td>
                      <td className={`${styles.r} ${styles.num}`}>{pct(f.positive_rate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div>
              <h3 className={styles.lbl}>Past cases on {symbol}</h3>
              <p className={styles.small}>
                Pick one to see it on the chart and judge whether it looks like the pattern.
              </p>
              <ul className={styles.cases}>
                {sel.recent.map((c) => (
                  <li key={eventId(c)}>
                    <button
                      type="button"
                      aria-pressed={eventId(c) === eventId(selected)}
                      onClick={() => onSelect(c)}
                    >
                      <span>{shortDate(c.open_time)}</span>
                      <span
                        className={
                          c.outcome.result === "win"
                            ? styles.up
                            : c.outcome.result === "loss"
                              ? styles.down
                              : styles.mute
                        }
                      >
                        {resultText(c)}
                      </span>
                    </button>
                  </li>
                ))}
                {sel.recent.length === 0 && <li className={styles.mute}>None on this coin.</li>}
              </ul>
            </div>
          </div>
        </>
      ) : (
        <p className={styles.mute}>
          {entry?.stats ? "No past cases measured for this pattern." : "Measuring…"}
        </p>
      )}
      <p className={styles.note}>
        A measured history, not a prediction. Confirm on the chart; a human places any trade.
      </p>
    </section>
  );
};

export default PatternLibrary;
