import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Explain, VerdictChip } from "../../common-components/Evidence";
import { usePlaybookStats, usePlaybookTrades } from "../../custom-hooks/useAnalysisApi";
import { price, shortDate } from "../../utils/format";
import {
  DEFAULT_PAPER,
  PAPER_STORAGE_KEY,
  parsePaperSettings,
  RISK_CHOICES,
  simulatePaper,
  usd,
  type PaperSettings,
} from "../../utils/paperAccount";
import {
  bestVariant,
  ENTRY_LABEL,
  EXIT_LABEL,
  findVariant,
  variantKey,
  type EntryKind,
  type ExitKind,
  type VariantKey,
} from "../../utils/playbook";
import { patternLabel } from "../../utils/patternLabels";
import { EquityChart } from "./EquityChart";
import styles from "./PaperPage.module.scss";

const PAGE = 50;

function loadSettings(): PaperSettings {
  try {
    const raw = localStorage.getItem(PAPER_STORAGE_KEY);
    return raw ? parsePaperSettings(JSON.parse(raw)) : DEFAULT_PAPER;
  } catch {
    return DEFAULT_PAPER;
  }
}

/**
 * Paper trading: the playbook's measured trades replayed in a dummy-money account, so its
 * record reads in dollars. Nothing is traded; the system never places orders.
 */
const PaperPage: React.FC = () => {
  const [settings, setSettings] = useState<PaperSettings>(loadSettings);
  const [picked, setPicked] = useState<VariantKey | null>(null);
  const [shown, setShown] = useState(PAGE);
  const stats = usePlaybookStats("4h", "15m").data;
  const key = picked ?? bestVariant(stats);
  const [entry, exit] = key.split("|") as [EntryKind, ExitKind];
  const res = usePlaybookTrades("4h", "15m", entry, exit);
  const variant = findVariant(stats, key);

  useEffect(() => {
    try {
      localStorage.setItem(PAPER_STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // Storage unavailable (private window): settings just don't persist.
    }
  }, [settings]);

  const result = useMemo(
    () => (res.data ? simulatePaper(res.data.trades, settings) : null),
    [res.data, settings],
  );
  const oneR = (settings.start * settings.riskPct) / 100;
  const recent = result ? [...result.fills].reverse() : [];
  const run = res.data?.run;

  return (
    <main className={styles.page}>
      <div className={styles.pagehead}>
        <div>
          <h1>Paper trading</h1>
          <p>
            The playbook's measured trades (4h pattern at a daily level, 15m entry) replayed in a
            dummy-money account, oldest first, after Binance fees. No real money, no orders.
          </p>
        </div>
      </div>

      <div className={styles.stack}>
        <section className={`${styles.card} ${styles.feature}`} aria-labelledby="r-title">
          <div className={styles.cardHead}>
            <h2 id="r-title">What "R" means, in dollars</h2>
          </div>
          <dl className={styles.explain}>
            <div>
              <dt>1R = the money you risk on one trade</dt>
              <dd>
                With {usd(settings.start)} and {settings.riskPct}% risk per trade, 1R ={" "}
                <strong>{usd(oneR)}</strong>. If the stop is hit you lose about {usd(oneR)} (a bit
                more after fees).
              </dd>
            </div>
            <div>
              <dt>+2R = twice what you risked</dt>
              <dd>
                A trade closing at +2R makes about {usd(2 * oneR)}; one at −1R loses {usd(oneR)}.
                The position size is set so the stop costs exactly 1R, whatever the coin.
              </dd>
            </div>
            <div>
              <dt>Mean R per trade = the average result</dt>
              <dd>
                −0.10R per trade means each trade loses about {usd(0.1 * oneR)} on average: over 100
                trades, about {usd(10 * oneR)}. Above zero is an account that grows.
              </dd>
            </div>
          </dl>
        </section>

        <section className={styles.card} aria-labelledby="set-title">
          <div className={styles.cardHead}>
            <h2 id="set-title">Account</h2>
            <p>Change these and everything below recalculates.</p>
          </div>
          <div className={styles.controls}>
            <label className={styles.variant}>
              Playbook variant
              <select
                value={key}
                onChange={(e) => {
                  setPicked(e.target.value as VariantKey);
                  setShown(PAGE);
                }}
              >
                {(stats?.variants ?? []).map((v) => (
                  <option key={variantKey(v.entry, v.exit)} value={variantKey(v.entry, v.exit)}>
                    {ENTRY_LABEL[v.entry]} · {EXIT_LABEL[v.exit]}
                    {v.all?.n ? ` (${v.all.n} trades)` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Starting balance (USDT)
              <input
                type="number"
                min={100}
                step={1000}
                value={settings.start}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v) && v >= 100) setSettings({ ...settings, start: v });
                }}
              />
            </label>
            <label>
              Risk per trade
              <select
                value={settings.riskPct}
                onChange={(e) => setSettings({ ...settings, riskPct: Number(e.target.value) })}
              >
                {RISK_CHOICES.map((r) => (
                  <option key={r} value={r}>
                    {r}% of the balance
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={settings.compound}
                onChange={(e) => setSettings({ ...settings, compound: e.target.checked })}
              />
              Size from the current balance{" "}
              <Explain title="Compounding">
                On: each trade risks {settings.riskPct}% of the balance when it opens, so risk grows
                after wins and shrinks after losses. Off: every trade risks {settings.riskPct}% of
                the starting balance.
              </Explain>
            </label>
          </div>
        </section>

        {res.error && <p className={styles.note}>{res.error}</p>}
        {!res.error && !result && <p className={styles.note}>Loading the measured trades…</p>}
        {result && result.fills.length === 0 && (
          <p className={styles.note}>
            {run?.status === "running"
              ? `The playbook is being measured in the background (${run.done}/${run.coins.length} coins)…`
              : "No measured trades for this variant yet: the background job runs with the analysis service."}
          </p>
        )}

        {result && result.fills.length > 0 && (
          <>
            <section className={styles.kpis} aria-label="Account summary">
              <div className={styles.card}>
                <span className={styles.lbl}>Balance now</span>
                <span className={styles.big}>{usd(result.balance)}</span>
                <span className={result.pnl >= 0 ? styles.up : styles.down}>
                  {usd(result.pnl, true)} ({result.returnPct >= 0 ? "+" : "−"}
                  {Math.abs(result.returnPct).toFixed(1)}%)
                </span>
              </div>
              <div className={styles.card}>
                <span className={styles.lbl}>Trades</span>
                <span className={styles.big}>{result.fills.length}</span>
                <span className={styles.mute}>
                  {result.wins} won · {result.losses} lost · up to {result.maxOpen} open at once
                </span>
              </div>
              <div className={styles.card}>
                <span className={styles.lbl}>Fees and slippage paid</span>
                <span className={styles.big}>{usd(result.fees)}</span>
                <span className={styles.mute}>
                  {usd(result.fees / result.fills.length)} per trade
                </span>
              </div>
              <div className={styles.card}>
                <span className={styles.lbl}>
                  Worst fall{" "}
                  <Explain title="Maximum drawdown">
                    The biggest drop from a previous high of the balance before it recovered (or to
                    the end): the pain you would have sat through.
                  </Explain>
                </span>
                <span className={`${styles.big} ${styles.down}`}>{usd(-result.maxDrawdown)}</span>
                <span className={styles.mute}>
                  {result.maxDrawdownPct.toFixed(1)}% from the high
                </span>
              </div>
            </section>

            <section className={styles.card} aria-labelledby="eq-title">
              <div className={styles.cardHead}>
                <h2 id="eq-title">Balance after each trade</h2>
                {variant?.all && <VerdictChip verdict={variant.all.verdict} />}
                <p>
                  {ENTRY_LABEL[entry]} · {EXIT_LABEL[exit]}. Green above the starting balance, red
                  below. Hover for the date and balance.
                </p>
              </div>
              <EquityChart points={result.equity} start={settings.start} />
              <p className={styles.note}>
                Past trades measured over {run ? Math.round((run.days / 365) * 10) / 10 : "2"} years
                of {run ? run.coins.length - run.failed.length : 10} coins, before funding payments.
                A replay, not a forecast: the same rules on new data can do better or worse. Before
                any real money, the variant has to prove itself in a forward test (Phase 4).
              </p>
            </section>

            <section className={styles.card} aria-labelledby="tr-title">
              <div className={styles.cardHead}>
                <h2 id="tr-title">Trades</h2>
                <p>
                  Latest first. Best {result.best ? usd(result.best.pnl, true) : "—"}, worst{" "}
                  {result.worst ? usd(result.worst.pnl, true) : "—"}.
                </p>
              </div>
              <div className={styles.scroll}>
                <table className={styles.tbl}>
                  <caption className="sr-only">Paper trades, latest first</caption>
                  <thead>
                    <tr>
                      <th>Closed</th>
                      <th>Coin</th>
                      <th>Setup</th>
                      <th className={styles.r}>Entry → exit</th>
                      <th className={styles.r}>Size</th>
                      <th className={styles.r}>Risked (1R)</th>
                      <th className={styles.r}>Result</th>
                      <th className={styles.r}>Fees</th>
                      <th className={styles.r}>Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.slice(0, shown).map((f, i) => {
                      const t = f.trade;
                      const long = t.direction === "long";
                      return (
                        <tr key={`${i}|${t.symbol}|${t.pattern}|${t.fillTime}`}>
                          <td>{t.exitTime ? shortDate(t.exitTime) : "—"}</td>
                          <td>
                            <Link to={`/chart/${t.symbol}`}>{t.symbol.replace("-USDT", "")}</Link>
                          </td>
                          <td>
                            <span className={long ? styles.up : styles.down}>
                              {long ? "Long" : "Short"}
                            </span>{" "}
                            {patternLabel(t.pattern)}
                            <small className={styles.sub}>exit: {t.reason ?? "—"}</small>
                          </td>
                          <td className={styles.r}>
                            {price(t.entryPrice)} →{" "}
                            {t.exitPrice !== null ? price(t.exitPrice) : "—"}
                            <small className={styles.sub}>stop {price(t.stop)}</small>
                          </td>
                          <td className={styles.r}>
                            {f.qty.toPrecision(3)}
                            <small className={styles.sub}>{usd(f.notional)}</small>
                          </td>
                          <td className={styles.r}>{usd(f.riskUsd)}</td>
                          <td className={`${styles.r} ${f.pnl >= 0 ? styles.up : styles.down}`}>
                            {usd(f.pnl, true)}
                            <small className={styles.sub}>
                              {t.rNet >= 0 ? "+" : "−"}
                              {Math.abs(t.rNet).toFixed(2)}R
                            </small>
                          </td>
                          <td className={styles.r}>{usd(f.fees)}</td>
                          <td className={styles.r}>{usd(f.balanceAfter)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {shown < recent.length && (
                <button type="button" className={styles.btn} onClick={() => setShown(shown + PAGE)}>
                  Show {Math.min(PAGE, recent.length - shown)} more of {recent.length}
                </button>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
};

export default PaperPage;
