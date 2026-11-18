import { useState } from "react";
import { Chip, Explain, VerdictChip } from "../../common-components/Evidence";
import { usePlaybook, usePlaybookStats } from "../../custom-hooks/useAnalysisApi";
import { PLAYBOOK_DAYS } from "../../services/AnalysisApi";
import type { CandleInterval } from "../../types/marketData";
import { pct, price } from "../../utils/format";
import { patternLabel } from "../../utils/patternLabels";
import { locationLabel } from "../../utils/setupKeys";
import {
  bestVariant,
  ENTRY_LABEL,
  EXIT_LABEL,
  findVariant,
  signedR,
  stageText,
  tradeText,
  variantKey,
  type VariantKey,
} from "../../utils/playbook";
import styles from "./Playbook.module.scss";

const STAGE_TONE = {
  waiting: "info",
  confirmed: "up",
  expired: "lock",
  invalidated: "down",
} as const;

/**
 * The multi-timeframe playbook for one coin: recent higher-timeframe setups at a level, where
 * each stands on the lower timeframe, the plan of the chosen variant, and its measured record.
 * The system confirms; a human trades.
 */
export function PlaybookCard({
  symbol,
  htf = "4h",
  ltf = "15m",
}: {
  symbol: string;
  htf?: CandleInterval;
  ltf?: CandleInterval;
}) {
  const stats = usePlaybookStats(htf, ltf).data;
  const live = usePlaybook(symbol, htf, ltf);
  const [picked, setPicked] = useState<VariantKey | null>(null);
  const key = picked ?? bestVariant(stats);
  const variant = findVariant(stats, key);
  const rec = variant?.all ?? null;
  const triggers = (live.data?.triggers ?? []).slice(0, 4);
  const run = stats?.run;

  return (
    <section className={`${styles.card} ${styles.feature}`} aria-labelledby="playbook-title">
      <div className={styles.head}>
        <h2 id="playbook-title">
          Playbook {htf} → {ltf}
        </h2>
        <Explain title="The playbook">
          1. A {htf} pattern confirms at a demand / supply zone or order block (the trigger, valid
          for 6 {htf} candles). 2. On {ltf}, wait for a change of character: a close beyond the last{" "}
          {ltf} swing. 3. Enter by the chosen variant; the stop goes beyond the {ltf} swing that
          started the move. 4. Exit by the chosen rule. Every variant is measured over two years of
          the research coins after Binance fees; pick one below or on Pattern stats. The system
          never places orders.
        </Explain>
        <p>
          <label className={styles.pick}>
            <span className="sr-only">Variant</span>
            <select value={key} onChange={(e) => setPicked(e.target.value as VariantKey)}>
              {(stats?.variants ?? []).map((v) => (
                <option key={variantKey(v.entry, v.exit)} value={variantKey(v.entry, v.exit)}>
                  {ENTRY_LABEL[v.entry]} · {EXIT_LABEL[v.exit]}
                  {v.all && v.all.n ? ` (${signedR(v.all.meanR)}, n ${v.all.n})` : ""}
                </option>
              ))}
            </select>
          </label>
        </p>
      </div>

      <div className={styles.record}>
        {rec && rec.n > 0 ? (
          <>
            <div>
              <span className={styles.lbl}>Mean R after costs</span>
              <span className={`${styles.num} ${rec.meanR > 0 ? styles.up : styles.down}`}>
                {signedR(rec.meanR)}
              </span>
              <small>
                95% range {signedR(rec.meanRLow)} to {signedR(rec.meanRHigh)}
              </small>
            </div>
            <div>
              <span className={styles.lbl}>Win rate</span>
              <span className={styles.num}>{pct(rec.winRate)}</span>
              <small>
                {rec.wins} of {rec.n} · avg win {signedR(rec.avgWinR)}
              </small>
            </div>
            <div>
              <span className={styles.lbl}>vs random entries</span>
              <span className={styles.num}>{signedR(rec.edgeVsRandom)}</span>
              <small>
                newer data: {variant?.outOfSample?.n ? signedR(variant.outOfSample.meanR) : "—"}
              </small>
            </div>
            <div className={styles.verdict}>
              <VerdictChip verdict={rec.verdict} />
            </div>
          </>
        ) : (
          <small className={styles.mute}>
            {run?.status === "running"
              ? `Measuring in the background: ${run.done}/${run.coins.length} coins…`
              : stats
                ? "Not measured yet: the background job runs with the analysis service."
                : "Loading the measured records…"}
          </small>
        )}
      </div>

      <h3 className={styles.subhead}>Recent {htf} setups at a level</h3>
      {live.error && <p className={styles.note}>{live.error}</p>}
      {!live.error && triggers.length === 0 && (
        <p className={styles.note}>
          {live.data
            ? `No ${htf} setup at a zone or order block in the last ${PLAYBOOK_DAYS} days.`
            : "Loading…"}
        </p>
      )}
      <ul className={styles.triggers}>
        {triggers.map((t) => {
          const tr = t.trades.find((x) => variantKey(x.entryKind, x.exitKind) === key);
          const long = t.direction === "long";
          return (
            <li key={`${t.pattern}${t.time}${t.direction}`}>
              <div className={styles.trigHead}>
                <Chip tone={STAGE_TONE[t.stage]}>{t.stage}</Chip>
                <span className={long ? styles.up : styles.down}>{long ? "Long" : "Short"}</span>
                <strong>{patternLabel(t.pattern)}</strong>
                <span className={styles.mute}>{locationLabel(t.location, t.direction)}</span>
              </div>
              <p className={styles.line}>{stageText(t, ltf)}</p>
              {t.stage === "confirmed" && tr && (
                <>
                  <dl className={styles.plan}>
                    <div>
                      <dt>Entry</dt>
                      <dd>{tr.entry !== null ? price(tr.entry) : "—"}</dd>
                    </div>
                    <div>
                      <dt>Stop</dt>
                      <dd className={styles.down}>{tr.stop !== null ? price(tr.stop) : "—"}</dd>
                    </div>
                    <div>
                      <dt>{tr.exitKind === "target" ? "Target" : "Exit"}</dt>
                      <dd className={styles.up}>
                        {tr.exitKind === "target"
                          ? tr.target !== null
                            ? price(tr.target)
                            : "—"
                          : tr.exitKind === "trail"
                            ? "trail"
                            : "1R · 2R · trail"}
                      </dd>
                    </div>
                  </dl>
                  <p className={styles.line}>{tradeText(tr)}</p>
                </>
              )}
            </li>
          );
        })}
      </ul>
      <p className={styles.note}>
        Measured before slippage beyond 0.02% and before funding. A lead to forward-test, not a
        signal to trade: no variant is a confirmation until it holds out of sample and in a forward
        test.
      </p>
    </section>
  );
}
