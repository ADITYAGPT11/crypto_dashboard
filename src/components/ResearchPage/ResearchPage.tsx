import { useEffect, useRef, useState } from "react";
import { Chip, Explain } from "../../common-components/Evidence";
import { useIngredients } from "../../custom-hooks/useAnalysisApi";
import { shortDate } from "../../utils/format";
import {
  findings,
  HORIZON_LABEL,
  rowsFor,
  VERDICT_LABEL,
  VERDICT_TONE,
} from "../../utils/research";
import { EffectChart } from "./EffectChart";
import styles from "./ResearchPage.module.scss";

const atr = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(3)}`;

/** Width of an element, kept in sync with resizes. */
function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [w, setW] = useState(800);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/**
 * Phase 2 research: which single ingredients tell anything about direction, before costs.
 * Only those worth building on are combined into strategies; nothing here is a trade signal.
 */
const ResearchPage: React.FC = () => {
  const res = useIngredients();
  const data = res.data;
  const [horizon, setHorizon] = useState(6);
  const [boxRef, width] = useWidth<HTMLDivElement>();
  const rows = data ? rowsFor(data.ingredients, horizon) : [];
  const cost = rows.length
    ? rows.reduce((s, r) => s + r.result.all.costAtr, 0) / rows.length
    : 0.07;
  const notes = data ? findings(data.ingredients) : [];
  const run = data?.run;

  return (
    <main className={styles.page}>
      <div className={styles.pagehead}>
        <div>
          <h1>Research: what predicts direction?</h1>
          <p>
            Single ingredients measured on their own over {run ? run.coins.length : 25} coins and
            {run ? ` ${Math.round((run.days / 365) * 10) / 10}` : " 2"} years of 4h candles, before
            any trading rule or cost. Only ingredients that show something are worth combining.
          </p>
        </div>
        <div className={styles.pills} role="group" aria-label="Horizon">
          {(data?.horizons ?? [1, 6, 24]).map((h) => (
            <button
              key={h}
              type="button"
              className={styles.pill}
              aria-pressed={h === horizon}
              onClick={() => setHorizon(h)}
            >
              {HORIZON_LABEL[h] ?? `${h} candles`}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.stack}>
        <section className={`${styles.card} ${styles.feature}`} aria-labelledby="find-title">
          <div className={styles.cardHead}>
            <h2 id="find-title">What holds up</h2>
            <p>
              {run?.status === "running"
                ? `Measuring in the background: ${run.done}/${run.coins.length} coins…`
                : run
                  ? `Updated ${shortDate(run.finishedAt ?? run.startedAt)} · ${data?.tests ?? 39} tests at once.`
                  : res.error
                    ? res.error
                    : "Not measured yet: the study runs with the analysis service."}
            </p>
          </div>
          {notes.length > 0 ? (
            <ul className={styles.findings}>
              {notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          ) : (
            data && <p className={styles.mute}>No ingredient shows a consistent effect yet.</p>
          )}
          <p className={styles.note}>
            Everything else on this page shows no consistent effect, including chart patterns at
            daily levels (the playbook's trigger), liquidity sweeps, CVD divergence and funding
            extremes. "Consistent" means the corrected 95% range excludes zero on all coins and the
            effect has the same sign on the 15 coins and the latest months the study was not
            designed on.
          </p>
        </section>

        <section className={styles.card} aria-labelledby="chart-title">
          <div className={styles.cardHead}>
            <h2 id="chart-title">
              Move after a signal, over {HORIZON_LABEL[horizon] ?? horizon}{" "}
              <Explain title="How to read this">
                <ul className={styles.method}>
                  <li>
                    For every signal, the move of the price in the signal&apos;s direction until the
                    horizon, in ATR (the coin&apos;s average candle range), so coins and years
                    compare. Dot = average; thick line = 95% range; thin line = the range corrected
                    for running {data?.tests ?? 39} tests at once.
                  </li>
                  <li>
                    Right of zero: price tended to go the signal&apos;s way; left: the other way.
                    The shaded band is a round trip&apos;s cost (taker fees and slippage): an effect
                    inside it would not pay for itself.
                  </li>
                  <li>
                    Signals of one ingredient on one coin never overlap, so each move counts once.
                    Highlighted rows hold up on new coins and newer months.
                  </li>
                </ul>
              </Explain>
            </h2>
            <p>Highlighted: consistent effect. Hover a row for its numbers.</p>
          </div>
          <div ref={boxRef} className={styles.chartBox}>
            {rows.length > 0 && (
              <EffectChart rows={rows} cost={cost} width={Math.max(560, width)} />
            )}
          </div>
          <p className={styles.legend}>
            <span>
              <i
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  background: "var(--t-signal)",
                }}
              />
              consistent effect
            </span>
            <span>
              <i
                style={{ width: 10, height: 10, borderRadius: "50%", background: "var(--t-muted)" }}
              />
              no consistent effect
            </span>
            <span>
              <i style={{ width: 18, height: 10, background: "rgba(240,163,94,0.25)" }} />
              round-trip cost (≈ {cost.toFixed(3)} ATR)
            </span>
          </p>
        </section>

        <section className={styles.card} aria-labelledby="tbl-title">
          <div className={styles.cardHead}>
            <h2 id="tbl-title">Every ingredient, over {HORIZON_LABEL[horizon] ?? horizon}</h2>
            <p>
              Average move per signal in ATR, on all coins and split: the original 10 coins vs 15
              new ones, the older 70% vs the latest 30%
              {data?.split ? ` (from ${shortDate(data.split)})` : ""}.
            </p>
          </div>
          <div className={styles.scroll}>
            <table className={styles.tbl}>
              <caption className="sr-only">Ingredient study results</caption>
              <thead>
                <tr>
                  <th>Ingredient</th>
                  <th className={styles.r}>Signals</th>
                  <th className={styles.r}>Move (ATR)</th>
                  <th className={styles.r}>Went its way</th>
                  <th className={styles.r}>10 coins</th>
                  <th className={styles.r}>15 new</th>
                  <th className={styles.r}>Older</th>
                  <th className={styles.r}>Newer</th>
                  <th>Verdict</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ ingredient: i, result: r }) => {
                  const a = r.all;
                  const tone = (v: number) => (v > 0 ? styles.up : v < 0 ? styles.down : undefined);
                  return (
                    <tr key={i.id}>
                      <td>
                        {i.label}
                        <small className={styles.sub}>{i.rule}</small>
                      </td>
                      <td className={styles.r}>{a.n.toLocaleString()}</td>
                      <td className={styles.r}>
                        <span className={tone(a.meanAtr)}>{atr(a.meanAtr)}</span>
                        <small className={styles.sub}>
                          adj. {atr(a.lowAdj)} to {atr(a.highAdj)}
                        </small>
                      </td>
                      <td className={styles.r}>{Math.round(a.hitRate * 100)}%</td>
                      <td className={`${styles.r} ${tone(r.orig10.meanAtr)}`}>
                        {atr(r.orig10.meanAtr)}
                      </td>
                      <td className={`${styles.r} ${tone(r.new15.meanAtr)}`}>
                        {atr(r.new15.meanAtr)}
                      </td>
                      <td className={`${styles.r} ${tone(r.older.meanAtr)}`}>
                        {atr(r.older.meanAtr)}
                      </td>
                      <td className={`${styles.r} ${tone(r.newer.meanAtr)}`}>
                        {atr(r.newer.meanAtr)}
                      </td>
                      <td>
                        <Chip tone={VERDICT_TONE[r.verdict]}>{VERDICT_LABEL[r.verdict]}</Chip>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
};

export default ResearchPage;
