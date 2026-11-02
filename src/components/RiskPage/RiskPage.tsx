import { useEffect, useId, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useResearchScan } from "../../custom-hooks/useScan";
import { LOCATION_LABELS } from "../../utils/setupAnalysis";
import { PATTERN_LABELS } from "../../utils/patterns";
import { parseSetupKey } from "../../utils/setupLibrary";
import {
  computePosition,
  expectedValue,
  loadRiskPrefs,
  saveRiskPrefs,
  type RiskInput,
} from "../../utils/riskCalc";
import { pct } from "../../utils/format";
import type { CandleInterval } from "../../types/marketData";
import { Chip, Explain, VerdictChip } from "../../common-components/Evidence";
import styles from "./RiskPage.module.scss";

const INTERVALS: readonly CandleInterval[] = ["1h", "4h", "1d"];
const HIGH_RISK_PCT = 2;

type Field = "account" | "riskPct" | "entry" | "stop" | "target" | "feePct";
type Draft = Record<Field, string>;

const FIELDS: { id: Field; label: string; step: string }[] = [
  { id: "account", label: "Account size (USDT)", step: "any" },
  { id: "riskPct", label: "Risk per trade (%)", step: "0.1" },
  { id: "entry", label: "Entry", step: "any" },
  { id: "stop", label: "Stop", step: "any" },
  { id: "target", label: "Target", step: "any" },
  { id: "feePct", label: "Fee per side (%)", step: "0.01" },
];

function money(v: number, digits = 2): string {
  return v.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function signedMoney(v: number): string {
  return `${v >= 0 ? "+" : "−"}${money(Math.abs(v))}`;
}

/** Up to 6 significant digits, enough for small-cap coin quantities. */
function qty(v: number): string {
  return v.toLocaleString("en-US", { maximumSignificantDigits: 6 });
}

function toInput(d: Draft): RiskInput {
  const n = (s: string) => (s.trim() === "" ? Number.NaN : Number(s));
  return {
    account: n(d.account),
    riskPct: n(d.riskPct),
    entry: n(d.entry),
    stop: n(d.stop),
    target: n(d.target),
    feePct: n(d.feePct),
  };
}

const RiskPage: React.FC = () => {
  const [params] = useSearchParams();
  const symbol = params.get("symbol") ?? "";
  const setup = parseSetupKey(params.get("setup"));
  const setupKey = setup ? `${setup.type}|${setup.location}` : null;
  const tf = INTERVALS.find((i) => i === params.get("tf")) ?? "4h";
  const base = symbol.split("-")[0] || "units";

  const [draft, setDraft] = useState<Draft>(() => {
    const prefs = loadRiskPrefs();
    return {
      account: String(prefs.account),
      riskPct: String(prefs.riskPct),
      feePct: String(prefs.feePct),
      entry: params.get("entry") ?? "",
      stop: params.get("stop") ?? "",
      target: params.get("target") ?? "",
    };
  });

  const input = toInput(draft);
  const result = computePosition(input);

  // Remember account size, risk and fee whenever they are valid.
  const { account, riskPct, feePct } = input;
  useEffect(() => {
    if (account > 0 && riskPct > 0 && riskPct <= 100 && feePct >= 0 && feePct <= 5) {
      saveRiskPrefs({ account, riskPct, feePct });
    }
  }, [account, riskPct, feePct]);

  const { scan, loading } = useResearchScan(tf, 0, setupKey !== null);
  const pooled = setupKey && scan ? (scan.pooled.get(setupKey) ?? null) : null;
  const ids = useId();

  return (
    <main className={styles.page}>
      <div className={styles.pagehead}>
        <div>
          <h1>Risk calculator</h1>
          <p>
            Size a trade so a stop-out costs exactly what you chose to risk. Nothing is sent to an
            exchange.
          </p>
        </div>
      </div>

      {setup ? (
        <section className={`${styles.card} ${styles.feature} ${styles.setup}`}>
          <div>
            <span className={styles.lbl}>Setup</span>
            <b>
              {symbol || "Any coin"} · {tf} · {PATTERN_LABELS[setup.type]}{" "}
              {LOCATION_LABELS[setup.location]}
            </b>
          </div>
          <div>
            <span className={styles.lbl}>Pooled record</span>
            <span className={styles.num}>
              {pooled
                ? `${pooled.wins} of ${pooled.n} · ${pct(pooled.winRate)} (${pct(pooled.ci[0])}–${pct(pooled.ci[1])})`
                : loading
                  ? "Loading…"
                  : "Not found on this timeframe"}
            </span>
          </div>
          {pooled && <VerdictChip verdict={pooled.verdict} />}
          {symbol && (
            <Link className={styles.link} to={`/chart/${symbol}`}>
              Back to chart
            </Link>
          )}
        </section>
      ) : (
        <p className={styles.hint}>
          Tip: open a setup on the <Link to="/chart">Chart</Link> and choose “Size this trade” to
          pre-fill entry, stop and target and see the setup's record here.
        </p>
      )}

      <div className={styles.two}>
        <form className={styles.card} onSubmit={(e) => e.preventDefault()}>
          <div className={styles.cardHead}>
            <h2>Your plan</h2>
            {result.ok && (
              <Chip tone={result.position.direction === "long" ? "up" : "down"}>
                {result.position.direction === "long"
                  ? "Long · stop below entry"
                  : "Short · stop above entry"}
              </Chip>
            )}
          </div>
          <div className={styles.fields}>
            {FIELDS.map((f) => (
              <label key={f.id} className={styles.field} htmlFor={`${ids}-${f.id}`}>
                {f.label}
                <input
                  id={`${ids}-${f.id}`}
                  type="number"
                  inputMode="decimal"
                  step={f.step}
                  value={draft[f.id]}
                  onChange={(e) => setDraft((d) => ({ ...d, [f.id]: e.target.value }))}
                />
              </label>
            ))}
          </div>
          {input.riskPct > HIGH_RISK_PCT && (
            <p className={styles.warnNote} role="status">
              Risking more than {HIGH_RISK_PCT}% per trade: 5 losses in a row (common even with a
              real edge) would cost about {money(100 - 100 * (1 - input.riskPct / 100) ** 5, 0)}% of
              the account.
            </p>
          )}
          {!result.ok && (
            <p className={styles.errNote} role="alert">
              {result.error}
            </p>
          )}
        </form>

        <section className={styles.card} aria-labelledby="pos-title" aria-live="polite">
          <div className={styles.cardHead}>
            <h2 id="pos-title">Position</h2>
          </div>
          {result.ok ? (
            <>
              <div className={styles.hero}>
                <span className={styles.lbl}>
                  {result.position.direction === "long" ? "Buy" : "Sell"}
                </span>
                <span className={styles.big}>
                  {qty(result.position.quantity)} {base}
                </span>
                <span className={`${styles.mute} ${styles.num}`}>
                  ≈ {money(result.position.notional, 0)} USDT notional ·{" "}
                  {money(result.position.leverage)}× account
                </span>
              </div>
              <dl className={styles.stats}>
                <div>
                  <dt>Loss at stop (incl. fees)</dt>
                  <dd className={styles.down}>−{money(result.position.lossAtStop)} USDT</dd>
                </div>
                <div>
                  <dt>Gain at target (after fees)</dt>
                  <dd className={styles.up}>+{money(result.position.gainAtTarget)} USDT</dd>
                </div>
                <div>
                  <dt>Stop distance</dt>
                  <dd>{money(result.position.stopPct)}%</dd>
                </div>
                <div>
                  <dt>Reward : risk</dt>
                  <dd>{money(result.position.rewardRisk)} R</dd>
                </div>
                <div>
                  <dt>Fees (entry + exit at target)</dt>
                  <dd>{money(result.position.feesAtTarget)} USDT</dd>
                </div>
                <div>
                  <dt>
                    Break-even win rate{" "}
                    <Explain title="Break-even win rate">
                      The share of trades that must hit the target, rather than the stop, for this
                      plan to make money after fees.
                    </Explain>
                  </dt>
                  <dd>{pct(result.position.breakEven, 1)}</dd>
                </div>
              </dl>
              {result.position.leverage > 1 && (
                <p className={styles.warnNote}>
                  The position is larger than the account: it needs{" "}
                  {money(result.position.leverage, 1)}× leverage. Check the exchange's liquidation
                  price is beyond your stop.
                </p>
              )}
              <div className={styles.ev}>
                <b>Expected value per trade, after fees</b>
                {pooled && pooled.n > 0 ? (
                  <>
                    <span
                      className={`${styles.evNum} ${expectedValue(result.position, pooled.winRate) >= 0 ? styles.up : styles.down}`}
                    >
                      {signedMoney(expectedValue(result.position, pooled.winRate))} USDT
                    </span>
                    <span className={`${styles.mute} ${styles.num}`}>
                      range {signedMoney(expectedValue(result.position, pooled.ci[0]))} to{" "}
                      {signedMoney(expectedValue(result.position, pooled.ci[1]))} USDT (at{" "}
                      {pct(pooled.ci[0])} and {pct(pooled.ci[1])})
                    </span>
                    <span className={styles.mute}>
                      From {pooled.n} past cases with their own targets; your plan's target may
                      differ. An estimate, not a prediction. Any single trade can lose.
                    </span>
                  </>
                ) : (
                  <span className={styles.mute}>
                    Needs a setup's measured win rate. Open one from the Chart or Pattern stats.
                  </span>
                )}
              </div>
            </>
          ) : (
            <p className={styles.mute}>Enter a valid plan to see the position.</p>
          )}
        </section>
      </div>

      <p className={styles.mute}>TCS never places orders. You decide and trade on your exchange.</p>
    </main>
  );
};

export default RiskPage;
