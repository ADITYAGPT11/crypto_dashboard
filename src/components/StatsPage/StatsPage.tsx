import { Fragment, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useCatalog, useSetupDetail, useStats } from "../../custom-hooks/useAnalysisApi";
import { patternLabel } from "../../utils/patternLabels";
import { locationLabel, parseSetupKey, toStats } from "../../utils/setupKeys";
import { analysisApi, statsKey } from "../../services/AnalysisApi";
import {
  filterAndSort,
  libraryTotals,
  statsByKey,
  type LibraryFilter,
  type LibrarySort,
} from "../../utils/setupLibrary";
import {
  loadDetection,
  zoneTfFor,
  ZONE_OPTIONS,
  type ZoneSourceOption,
} from "../../utils/detectionConfig";
import { pct, shortDate, signedPct, signedR } from "../../utils/format";
import type { CandleInterval } from "../../types/marketData";
import type { LocationFilter } from "../../types/analysis";
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

const LOCATION_PICKS: { id: LocationFilter | "all"; label: string }[] = [
  { id: "all", label: "Every location" },
  { id: "*", label: "Pattern only (any location)" },
  { id: "confluence", label: "At zone + order block" },
  { id: "zone", label: "At a demand / supply zone" },
  { id: "orderBlock", label: "At an order block" },
  { id: "openSpace", label: "In open space" },
];

/** One coin at a time for an opened row, from the backend's per-coin statistics. */
function CoinBreakdown({
  tf,
  zoneTf,
  setupKey,
}: {
  tf: CandleInterval;
  zoneTf: CandleInterval;
  setupKey: string;
}) {
  const setup = parseSetupKey(setupKey);
  const d = useSetupDetail(tf, zoneTf, setup);
  if (!setup) return null;
  if (!d.data) return <p className={styles.mute}>{d.error ?? "Loading each coin…"}</p>;
  const rows = d.data.perCoin.map((c) => ({
    symbol: c.symbol,
    stats: toStats(setup.pattern, setup.direction, setup.location, c.summary),
  }));
  return (
    <>
      <p className={styles.mute}>
        The same setup on each coin alone. Small samples per coin are normal: the pooled row above
        is the evidence.
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
          {rows.map(({ symbol, stats }) => (
            <tr key={symbol}>
              <td>
                <b>{symbol}</b>
              </td>
              <td className={`${styles.r} ${styles.num}`}>{stats.n}</td>
              <td className={`${styles.r} ${styles.num}`}>{pct(stats.winRate)}</td>
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
    </>
  );
}

const StatsPage: React.FC = () => {
  const [params, setParams] = useSearchParams();
  const interval = asInterval(params.get("tf"));
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const [sort, setSort] = useState<LibrarySort>("n");
  const [open, setOpen] = useState<string | null>(null);

  const [zones, setZones] = useState<ZoneSourceOption>(() => loadDetection().zones);
  const [where, setWhere] = useState<LocationFilter | "all">("all");
  const zoneTf = zoneTfFor(interval, zones);
  const catalog = useCatalog().data;
  const res = useStats(interval, zoneTf);
  const run = res.data?.run ?? null;
  const loading = !res.data && !res.error;
  const maxHold = catalog?.maxHoldBars ?? 30;
  const minSample = catalog?.minSample ?? 30;

  const all = useMemo(
    () =>
      [...statsByKey(res.data).values()].filter(
        (s) => s.n > 0 && (where === "all" ? s.location !== "*" : s.location === where),
      ),
    [res.data, where],
  );
  const rows = useMemo(() => filterAndSort(all, filter, sort), [all, filter, sort]);
  const totals = libraryTotals(all);
  const coins = run ? run.coins.length - run.failed.length : 0;
  const failed = run?.failed ?? [];
  const years = run ? Math.round((run.days / 365) * 10) / 10 : null;

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
            Every pattern × direction × location, measured in the background on closed {interval}{" "}
            candles across {coins || "the research"} coins
            {years ? ` over ${years} years` : ""}, with {zoneTf} zones and order blocks. Win =
            target hit before stop within {maxHold} candles. Gross: before fees.
            {run?.finishedAt ? ` Updated ${shortDate(run.finishedAt)}.` : ""}
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

      <div className={styles.controls}>
        <label className={styles.sort}>
          Zones and order blocks from
          <select value={zones} onChange={(e) => setZones(e.target.value as ZoneSourceOption)}>
            {ZONE_OPTIONS.map((z) => (
              <option key={z} value={z}>
                {z === "same" ? `same (${interval})` : `${zoneTfFor(interval, z)}`}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.sort}>
          Location
          <select
            value={where}
            onChange={(e) => setWhere(e.target.value as LocationFilter | "all")}
          >
            {LOCATION_PICKS.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {res.error && (
        <div className={styles.alert} role="alert">
          <span>{res.error}</span>
          <button
            type="button"
            className={styles.btn}
            onClick={() => void analysisApi().stats.refresh(statsKey(interval, zoneTf))}
          >
            Try again
          </button>
        </div>
      )}
      {run?.status === "running" && (
        <div className={styles.alert} role="status">
          <span>
            Measuring in the background: {run.done} of {run.coins.length} coins done. The table
            fills in when the run finishes.
          </span>
        </div>
      )}
      {failed.length > 0 && (
        <div className={styles.alert} role="alert">
          <span>
            History for {failed.join(", ")} couldn't be loaded by the analysis service; statistics
            use the other coins.
          </span>
        </div>
      )}

      <section className={styles.kpis} aria-label="Summary" aria-busy={loading}>
        <div className={styles.card}>
          <span className={styles.lbl}>Setups measured</span>
          <span className={styles.big}>{res.data ? totals.setups : "…"}</span>
          <span className={styles.mute}>pattern × direction × location</span>
        </div>
        <div className={styles.card}>
          <span className={styles.lbl}>Resolved cases</span>
          <span className={styles.big}>
            {res.data ? totals.resolved.toLocaleString("en-US") : "…"}
          </span>
          <span className={styles.mute}>target or stop hit</span>
        </div>
        <div className={styles.card}>
          <span className={styles.lbl}>Edge candidates</span>
          <span className={`${styles.big} ${styles.up}`}>{res.data ? totals.edge : "…"}</span>
          <span className={styles.mute}>whole range above break-even</span>
        </div>
        <div className={styles.card}>
          <span className={styles.lbl}>Too few cases</span>
          <span className={`${styles.big} ${styles.warn}`}>{res.data ? totals.tooFew : "…"}</span>
          <span className={styles.mute}>under {minSample}, no verdict yet</span>
        </div>
      </section>

      <section className={`${styles.card} ${styles.feature}`} aria-labelledby="lib-title">
        <div className={styles.cardHead}>
          <h2 id="lib-title">Setup library</h2>
          <Explain title="Reading this table">
            Each row pools every past case of one setup across all coins. The bar is the 95% range
            of the true win rate; the tick is the break-even win rate given the average win size.
            Edge candidate: at least {minSample} cases and the whole range right of the tick. Open a
            row to see each coin on its own.
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
                            <span className={s.direction === "long" ? styles.up : styles.down}>
                              {s.direction === "long" ? "▲" : "▼"}
                            </span>{" "}
                            <b>{patternLabel(s.pattern)}</b>
                            <span className={styles.mute}>
                              {" "}
                              {locationLabel(s.location, s.direction)}
                            </span>
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
                          <CoinBreakdown tf={interval} zoneTf={zoneTf} setupKey={s.key} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {loading && (
                <tr>
                  <td colSpan={10} className={styles.mute}>
                    Loading the statistics…
                  </td>
                </tr>
              )}
              {res.data && rows.length === 0 && (
                <tr>
                  <td colSpan={10} className={styles.mute}>
                    {run?.status === "done" || run?.status === "failed"
                      ? `No setup matches this filter on ${interval}.`
                      : "Not measured yet: the background job runs when the analysis service starts."}
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
                  at least {minSample} resolved cases, pooled across coins
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
