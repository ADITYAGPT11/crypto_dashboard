import { Fragment, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useResearchScan } from "../../custom-hooks/useScan";
import { LOCATION_LABELS, MAX_HOLD_BARS, MIN_SAMPLE } from "../../utils/setupAnalysis";
import { PATTERN_LABELS } from "../../utils/patterns";
import {
  filterAndSort,
  libraryTotals,
  perSymbolStats,
  type LibraryFilter,
  type LibrarySort,
} from "../../utils/setupLibrary";
import { pct, signedPct, signedR } from "../../utils/format";
import type { CandleInterval } from "../../types/marketData";
import { CiBar, Explain, VerdictChip } from "../../common-components/Evidence";
import styles from "./StatsPage.module.scss";

export const STATS_INTERVALS: readonly CandleInterval[] = ["1h", "4h", "1d"];

const FILTERS: { id: LibraryFilter; label: string }[] = [
  { id: "all", label: "All verdicts" },
  { id: "edge", label: "Edge candidates" },
  { id: "noEdge", label: "No edge" },
  { id: "tooFew", label: "Too few cases" },
];

const SORTS: { id: LibrarySort; label: string }[] = [
  { id: "n", label: "Most cases" },
  { id: "winRate", label: "Win rate" },
  { id: "expectancy", label: "Expectancy" },
];

function asInterval(value: string | null): CandleInterval {
  return STATS_INTERVALS.find((i) => i === value) ?? "4h";
}

const StatsPage: React.FC = () => {
  const [params, setParams] = useSearchParams();
  const interval = asInterval(params.get("tf"));
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const [sort, setSort] = useState<LibrarySort>("n");
  const [open, setOpen] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const { universe, loading, scan, candles, failed } = useResearchScan(interval, attempt);

  const all = useMemo(() => (scan ? [...scan.pooled.values()] : []), [scan]);
  const rows = useMemo(() => filterAndSort(all, filter, sort), [all, filter, sort]);
  const totals = libraryTotals(all);
  const coins = candles.size;

  const pickInterval = (tf: CandleInterval) => {
    setOpen(null);
    setParams(tf === "4h" ? {} : { tf }, { replace: true });
  };

  return (
    <main className={styles.page}>
      <div className={styles.pagehead}>
        <div>
          <h1>Pattern stats</h1>
          <p>
            Every pattern × location, measured on closed {interval} candles across{" "}
            {coins || universe.length} coins. Win = target hit before stop within {MAX_HOLD_BARS}{" "}
            candles. Gross: before fees.
          </p>
        </div>
        <div className={styles.pills} role="group" aria-label="Timeframe">
          {STATS_INTERVALS.map((tf) => (
            <button
              key={tf}
              type="button"
              className={styles.pill}
              aria-pressed={tf === interval}
              onClick={() => pickInterval(tf)}
            >
              {tf}
            </button>
          ))}
        </div>
      </div>

      {failed.length > 0 && (
        <div className={styles.alert} role="alert">
          <span>
            Couldn't load {interval} history for {failed.join(", ")}.{" "}
            {coins > 0
              ? "Statistics use the coins that loaded."
              : "Binance's public API must be reachable from this browser."}
          </span>
          <button type="button" className={styles.btn} onClick={() => setAttempt((a) => a + 1)}>
            Try again
          </button>
        </div>
      )}

      <section className={styles.kpis} aria-label="Summary" aria-busy={loading}>
        <div className={styles.card}>
          <span className={styles.lbl}>Setups measured</span>
          <span className={styles.big}>{scan ? totals.setups : "…"}</span>
          <span className={styles.mute}>pattern × location pairs</span>
        </div>
        <div className={styles.card}>
          <span className={styles.lbl}>Resolved cases</span>
          <span className={styles.big}>{scan ? totals.resolved.toLocaleString("en-US") : "…"}</span>
          <span className={styles.mute}>target or stop hit</span>
        </div>
        <div className={styles.card}>
          <span className={styles.lbl}>Edge candidates</span>
          <span className={`${styles.big} ${styles.up}`}>{scan ? totals.edge : "…"}</span>
          <span className={styles.mute}>whole range above break-even</span>
        </div>
        <div className={styles.card}>
          <span className={styles.lbl}>Too few cases</span>
          <span className={`${styles.big} ${styles.warn}`}>{scan ? totals.tooFew : "…"}</span>
          <span className={styles.mute}>under {MIN_SAMPLE}, no verdict yet</span>
        </div>
      </section>

      <section className={`${styles.card} ${styles.feature}`} aria-labelledby="lib-title">
        <div className={styles.cardHead}>
          <h2 id="lib-title">Setup library</h2>
          <Explain title="Reading this table">
            Each row pools every past case of one setup across all coins. The bar is the 95% range
            of the true win rate; the tick is the break-even win rate given the average win size.
            Edge candidate: at least {MIN_SAMPLE} cases and the whole range right of the tick. Open
            a row to see each coin on its own.
          </Explain>
          <div className={styles.controls}>
            <div className={styles.pills} role="group" aria-label="Verdict">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className={styles.pill}
                  aria-pressed={f.id === filter}
                  onClick={() => setFilter(f.id)}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <label className={styles.sort}>
              Sort by
              <select value={sort} onChange={(e) => setSort(e.target.value as LibrarySort)}>
                {SORTS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
        <div className={styles.xs}>
          <table className={styles.tbl}>
            <thead>
              <tr>
                <th>Setup</th>
                <th className={styles.r}>n</th>
                <th className={styles.r}>Win rate</th>
                <th className={styles.ciCol}>95% range vs break-even</th>
                <th className={styles.r}>Avg win</th>
                <th className={styles.r}>Avg loss</th>
                <th className={styles.r}>Break-even</th>
                <th className={styles.r}>Expectancy</th>
                <th>Verdict</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const isOpen = open === s.key;
                const breakdown = isOpen && scan ? perSymbolStats(scan, s.key) : [];
                return (
                  <Fragment key={s.key}>
                    <tr>
                      <td>
                        <button
                          type="button"
                          className={styles.rowBtn}
                          aria-expanded={isOpen}
                          aria-controls={`coins-${s.key}`}
                          onClick={() => setOpen(isOpen ? null : s.key)}
                        >
                          <span aria-hidden="true" className={styles.caret}>
                            {isOpen ? "▾" : "▸"}
                          </span>
                          <span>
                            <b>{PATTERN_LABELS[s.type]}</b>
                            <span className={styles.mute}> {LOCATION_LABELS[s.location]}</span>
                          </span>
                        </button>
                      </td>
                      <td className={`${styles.r} ${styles.num}`}>{s.n}</td>
                      <td className={`${styles.r} ${styles.num}`}>
                        {pct(s.winRate)}
                        <span className={styles.sub}>
                          {s.wins} of {s.n}
                        </span>
                      </td>
                      <td>
                        <CiBar stats={s} />
                        <span className={styles.sub}>
                          {pct(s.ci[0])}–{pct(s.ci[1])}
                        </span>
                      </td>
                      <td className={`${styles.r} ${styles.num} ${styles.up}`}>
                        {s.wins ? signedPct(s.avgWinPct) : "—"}
                      </td>
                      <td className={`${styles.r} ${styles.num} ${styles.down}`}>
                        {s.losses ? signedPct(s.avgLossPct) : "—"}
                      </td>
                      <td className={`${styles.r} ${styles.num}`}>{pct(s.breakEven)}</td>
                      <td
                        className={`${styles.r} ${styles.num} ${s.expectancyR >= 0 ? styles.up : styles.down}`}
                      >
                        {signedR(s.expectancyR)}
                      </td>
                      <td>
                        <VerdictChip verdict={s.verdict} />
                      </td>
                      <td>
                        <Link
                          className={styles.btnSm}
                          to={`/alerts?setup=${encodeURIComponent(s.key)}&tf=${interval}`}
                        >
                          Alert me
                        </Link>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr id={`coins-${s.key}`} className={styles.detail}>
                        <td colSpan={10}>
                          <p className={styles.mute}>
                            The same setup on each coin alone. Small samples per coin are normal:
                            the pooled row above is the evidence.
                          </p>
                          <table className={styles.inner}>
                            <thead>
                              <tr>
                                <th>Coin</th>
                                <th className={styles.r}>n</th>
                                <th className={styles.r}>Win rate</th>
                                <th className={styles.ciCol}>95% range</th>
                                <th className={styles.r}>Expectancy</th>
                                <th>Verdict</th>
                                <th>
                                  <span className="sr-only">Chart</span>
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {breakdown.map(({ symbol, stats }) => (
                                <tr key={symbol}>
                                  <td>
                                    <b>{symbol}</b>
                                  </td>
                                  <td className={`${styles.r} ${styles.num}`}>{stats.n}</td>
                                  <td className={`${styles.r} ${styles.num}`}>
                                    {pct(stats.winRate)}
                                  </td>
                                  <td>
                                    <CiBar stats={stats} />
                                  </td>
                                  <td
                                    className={`${styles.r} ${styles.num} ${stats.expectancyR >= 0 ? styles.up : styles.down}`}
                                  >
                                    {signedR(stats.expectancyR)}
                                  </td>
                                  <td>
                                    <VerdictChip verdict={stats.verdict} />
                                  </td>
                                  <td>
                                    <Link className={styles.btnSm} to={`/chart/${symbol}`}>
                                      Chart
                                    </Link>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {!scan && (
                <tr>
                  <td colSpan={10} className={styles.mute}>
                    Loading {interval} history for {universe.length} coins, then measuring every
                    past case…
                  </td>
                </tr>
              )}
              {scan && rows.length === 0 && (
                <tr>
                  <td colSpan={10} className={styles.mute}>
                    No setup matches this filter on {interval}.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className={styles.note}>
          Expectancy is the mean result per resolved case in R (1R = the distance to the stop),
          before fees. An edge candidate still has to pass a costed, out-of-sample backtest before
          it can confirm anything.
        </p>
      </section>

      <div className={styles.two}>
        <section className={styles.card} aria-labelledby="path-title">
          <div className={styles.cardHead}>
            <h2 id="path-title">How a setup becomes a confirmation</h2>
          </div>
          <ol className={styles.steps}>
            <li>
              <span className={styles.stepOn}>1</span>
              <span>
                <b>Detected</b>{" "}
                <span className={styles.mute}>pattern confirmed on closed candles only</span>
              </span>
            </li>
            <li>
              <span className={styles.stepOn}>2</span>
              <span>
                <b>Measured</b>{" "}
                <span className={styles.mute}>
                  at least {MIN_SAMPLE} resolved cases, pooled across coins
                </span>
              </span>
            </li>
            <li>
              <span className={styles.stepUp}>3</span>
              <span>
                <b>Edge candidate</b>{" "}
                <span className={styles.mute}>whole 95% range above break-even</span>
              </span>
            </li>
            <li>
              <span className={styles.stepOff}>4</span>
              <span>
                <b>Costed backtest</b>{" "}
                <span className={styles.mute}>fees, slippage, out-of-sample years (Phase 2)</span>
              </span>
            </li>
            <li>
              <span className={styles.stepOff}>5</span>
              <span>
                <b>Forward test</b>{" "}
                <span className={styles.mute}>live paper results match the backtest</span>
              </span>
            </li>
            <li>
              <span className={styles.stepOff}>6</span>
              <span>
                <b>Confirmation</b>{" "}
                <span className={styles.mute}>
                  shown with its measured confidence; you decide and trade
                </span>
              </span>
            </li>
          </ol>
        </section>

        <section className={styles.card} aria-labelledby="guard-title">
          <div className={styles.cardHead}>
            <h2 id="guard-title">Guards against fooling ourselves</h2>
          </div>
          <ul className={styles.guards}>
            <li>
              <b>Rules fixed in code first.</b> Entry, stop and target are set before anything is
              measured.
            </li>
            <li>
              <b>No look-ahead.</b> A pattern counts only with candles that existed at that moment.
            </li>
            <li>
              <b>Pooled, not cherry-picked.</b> One coin's 4 of 5 is noise; the same setup across
              coins is the evidence.
            </li>
            <li>
              <b>Many tests, some luck.</b> With {totals.setups || "several"} setups tested, a 95%
              range can clear break-even by chance about 1 time in 20. Out-of-sample data decides.
            </li>
            <li>
              <b>Gross for now.</b> Fees and slippage arrive in Phase 2 and will lower every number
              here.
            </li>
          </ul>
        </section>
      </div>
    </main>
  );
};

export default StatsPage;
