import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Explain, VerdictChip } from "../../common-components/Evidence";
import { useForward, usePlaybookStats, usePlaybookTrades } from "../../custom-hooks/useAnalysisApi";
import { Chip } from "../../common-components/Evidence";
import { price, shortDate } from "../../utils/format";
import {
  DEFAULT_PAPER,
  forwardToPaper,
  PAPER_MODE_KEY,
  PAPER_STORAGE_KEY,
  type PaperMode,
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

function loadMode(): PaperMode {
  try {
    return localStorage.getItem(PAPER_MODE_KEY) === "replay" ? "replay" : "forward";
  } catch {
    return "forward";
  }
}

const when = (ms: number | null | undefined) =>
  ms ? new Date(ms).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—";

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
  const [mode, setMode] = useState<PaperMode>(loadMode);
  const [picked, setPicked] = useState<VariantKey | null>(null);
  const [shown, setShown] = useState(PAGE);
  const stats = usePlaybookStats("4h", "15m").data;
  const key = picked ?? bestVariant(stats);
  const [entry, exit] = key.split("|") as [EntryKind, ExitKind];
  const replay = usePlaybookTrades("4h", "15m", entry, exit);
  const fwd = useForward("4h", "15m", entry, exit);
  const variant = findVariant(stats, key);
  const forward = mode === "forward";

  useEffect(() => {
    try {
      localStorage.setItem(PAPER_STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // Storage unavailable (private window): settings just don't persist.
    }
  }, [settings]);

  useEffect(() => {
    try {
      localStorage.setItem(PAPER_MODE_KEY, mode);
    } catch {
      // Not persisted: fine.
    }
  }, [mode]);

  const trades = useMemo(
    () =>
      forward ? (fwd.data ? forwardToPaper(fwd.data.trades) : null) : (replay.data?.trades ?? null),
    [forward, fwd.data, replay.data],
  );
  const result = useMemo(
    () => (trades ? simulatePaper(trades, settings) : null),
    [trades, settings],
  );
  const res = forward ? fwd : replay;
  const live = fwd.data?.trades ?? [];
  const open = live.filter((t) => t.status === "open");
  const pending = live.filter((t) => t.status === "pending");
  const oneR = (settings.start * settings.riskPct) / 100;
  const recent = result ? [...result.fills].reverse() : [];
  const run = replay.data?.run;

  return (
    <main className={styles.page}>
      <div className={styles.pagehead}>
        <div>
          <h1>Paper trading</h1>
          <p>
            The playbook (4h pattern at a daily level, 15m entry) in a dummy-money account, after
            Binance fees. No real money, no orders.
          </p>
        </div>
        <div className={styles.pills} role="group" aria-label="Which trades">
          <button
            type="button"
            className={styles.pill}
            aria-pressed={forward}
            onClick={() => setMode("forward")}
          >
            Live forward test
          </button>
          <button
            type="button"
            className={styles.pill}
            aria-pressed={!forward}
            onClick={() => setMode("replay")}
          >
            Past 2 years (replay)
          </button>
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

        {forward && (
          <section className={`${styles.card} ${styles.feature}`} aria-labelledby="fw-title">
            <div className={styles.cardHead}>
              <h2 id="fw-title">Live forward test</h2>
              <Explain title="Forward paper trading">
                The analysis service follows every research coin every 5 minutes and records each
                new 4h setup at a daily level and its 15m trade, by the same rules as the replay,
                the moment it happens. Only setups that appeared after tracking started count, so
                nothing here was fitted to these trades: this is the honest test of the playbook. A
                trade marked late was first seen after its entry (the service was off then).
                Changing the rules restarts the record.
              </Explain>
              <p>
                {fwd.data?.startedAt
                  ? `Tracking since ${when(fwd.data.startedAt)} · last check ${when(fwd.data.lastRun)} · ${fwd.data.signals} setups seen.`
                  : "Not started: tracking begins when the analysis service runs (npm start)."}
              </p>
            </div>
            {open.length + pending.length === 0 ? (
              <p className={styles.mute}>No trade open or waiting for a fill right now.</p>
            ) : (
              <div className={styles.scroll}>
                <table className={styles.tbl}>
                  <caption className="sr-only">Open and pending forward trades</caption>
                  <thead>
                    <tr>
                      <th>Status</th>
                      <th>Coin</th>
                      <th>Setup</th>
                      <th className={styles.r}>Entry</th>
                      <th className={styles.r}>Stop now</th>
                      <th>Since</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...open, ...pending].map((t) => (
                      <tr key={`${t.symbol}|${t.time}|${t.pattern}|${t.direction}`}>
                        <td>
                          <Chip tone={t.status === "open" ? "up" : "info"}>
                            {t.status === "open" ? "open" : "limit waiting"}
                          </Chip>
                          {t.late && <Chip tone="warn">late</Chip>}
                        </td>
                        <td>
                          <Link to={`/chart/${t.symbol}`}>{t.symbol.replace("-USDT", "")}</Link>
                        </td>
                        <td>
                          <span className={t.direction === "long" ? styles.up : styles.down}>
                            {t.direction === "long" ? "Long" : "Short"}
                          </span>{" "}
                          {patternLabel(t.pattern)}
                        </td>
                        <td className={styles.r}>
                          {t.entryPrice !== null ? price(t.entryPrice) : "—"}
                        </td>
                        <td className={styles.r}>
                          {t.stopNow !== null
                            ? price(t.stopNow)
                            : t.stop !== null
                              ? price(t.stop)
                              : "—"}
                        </td>
                        <td>{when(t.fillTime ?? t.firstSeen)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {res.error && <p className={styles.note}>{res.error}</p>}
        {!res.error && !result && <p className={styles.note}>Loading the measured trades…</p>}
        {result && result.fills.length === 0 && forward && (
          <p className={styles.note}>
            No forward trade has closed yet. Results appear as new setups at daily levels form and
            play out, typically over days; until then, the replay shows how these rules did on the
            past two years.
          </p>
        )}
        {result && result.fills.length === 0 && !forward && (
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
              {forward ? (
                <p className={styles.note}>
                  Recorded live, as it happened, since tracking started (before funding payments).
                  Too few trades for a verdict until there are dozens; the verdict chip above is the
                  2-year replay's. If this record holds up over months, the variant is ready to be
                  considered with real money; if it fades, it was luck.
                </p>
              ) : (
                <p className={styles.note}>
                  Past trades measured over {run ? Math.round((run.days / 365) * 10) / 10 : "2"}{" "}
                  years of {run ? run.coins.length - run.failed.length : 10} coins, before funding
                  payments. A replay, not a forecast: the same rules on new data can do better or
                  worse. The live forward test is where a variant proves itself.
                </p>
              )}
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
