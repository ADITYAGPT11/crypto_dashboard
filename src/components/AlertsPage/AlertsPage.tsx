import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useCatalog } from "../../custom-hooks/useAnalysisApi";
import { useSetupAlerts } from "../../custom-hooks/useSetupAlerts";
import { SetupAlertService, type TelegramStatus } from "../../services/SetupAlertService";
import { parseSetupKey, setupKey as keyOf } from "../../utils/setupKeys";
import { isPicked, loadDetection, patternOptions } from "../../utils/detectionConfig";
import { patternLabel } from "../../utils/patternLabels";
import { ALERT_INTERVALS, setupName, WATCHLIST, type Delivery } from "../../utils/setupAlerts";
import { loadWatchlist } from "../../utils/watchlistStorage";
import { price } from "../../utils/format";
import type { Direction } from "../../types/analysis";
import type { CandleInterval } from "../../types/marketData";
import { Chip } from "../../common-components/Evidence";
import { BRAND } from "../../brand";
import styles from "./AlertsPage.module.scss";

const TELEGRAM_TEXT: Record<TelegramStatus, string> = {
  unknown: "Checking the backend…",
  configured: "Telegram is connected through the backend.",
  notConfigured:
    "The backend is running but has no Telegram bot yet: add a bot token and chat id with POST /telegram/config.",
  offline:
    "The backend isn't reachable, so alerts show here only. Start it with npm run backend to get Telegram messages.",
};

const DELIVERY: Record<Delivery, { tone: "up" | "down" | "warn" | "lock"; text: string }> = {
  sent: { tone: "up", text: "Telegram sent" },
  failed: { tone: "down", text: "Telegram failed" },
  offline: { tone: "warn", text: "Backend offline" },
  off: { tone: "lock", text: "In-app only" },
};

function when(ms: number): string {
  return new Date(ms).toLocaleString("en-GB", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const AlertsPage: React.FC = () => {
  const [params] = useSearchParams();
  const alerts = useSetupAlerts();
  const svc = SetupAlertService.getInstance();
  const watchlist = useMemo(() => loadWatchlist(), []);

  const initialSetup = parseSetupKey(params.get("setup"));
  const [symbol, setSymbol] = useState(params.get("symbol") ?? watchlist[0] ?? "BTC-USDT");
  // New alerts fire on a chart pattern at any location.
  const [setup, setSetup] = useState(
    initialSetup
      ? keyOf(initialSetup.pattern, initialSetup.direction, "*")
      : keyOf("doubleBottom", "long", "*"),
  );
  const setupInfo = parseSetupKey(setup) ?? {
    pattern: "doubleBottom",
    direction: "long" as Direction,
  };
  const catalog = useCatalog().data;
  const patternChoices = useMemo(
    () =>
      // The patterns picked in the chart's Patterns panel (chart patterns by default).
      patternOptions(catalog)
        .filter((o) => isPicked(loadDetection(), o))
        .map((o) => ({
          value: o.key,
          label: `${o.direction === "long" ? "▲" : "▼"} ${o.label}`,
        })),
    [catalog],
  );
  const [interval, setTf] = useState<CandleInterval>(
    ALERT_INTERVALS.find((i) => i === params.get("tf")) ?? "4h",
  );
  const [telegram, setTelegram] = useState(true);
  const [inApp, setInApp] = useState(true);
  const [saved, setSaved] = useState<string | null>(null);
  const [test, setTest] = useState<Delivery | "sending" | null>(null);

  const coins = useMemo(() => [...new Set([symbol, ...watchlist])], [symbol, watchlist]);

  const save = () => {
    const rule = svc.addRule({ symbol, setupKey: setup, interval, telegram, inApp });
    setSaved(
      rule
        ? `Saved. You'll be told the next time ${symbol === WATCHLIST ? "a watchlist coin" : symbol} prints this setup on ${interval}.`
        : "You have the maximum number of alerts; remove one first.",
    );
  };

  const sendTest = async () => {
    setTest("sending");
    setTest(await svc.sendTest());
    void svc.refreshTelegramStatus();
  };

  return (
    <main className={styles.page}>
      <div className={styles.pagehead}>
        <div>
          <h1>Alerts</h1>
          <p>
            Get told when a setup prints, with its checklist (order block or zone, RSI, volume,
            VWAP, ATR, Supertrend) attached. You decide the trade.
          </p>
        </div>
      </div>

      <p className={styles.banner} role="note">
        Alerts are checked every minute while a {BRAND.name} tab is open, against setups the
        analysis service confirms on closed candles (same-timeframe zones and order blocks).{" "}
        {TELEGRAM_TEXT[alerts.telegram]}
      </p>

      <div className={styles.layout}>
        <section className={`${styles.card} ${styles.feature}`} aria-labelledby="new-title">
          <div className={styles.cardHead}>
            <h2 id="new-title">New alert</h2>
          </div>

          <p className={styles.sentence}>
            Tell me when <b>{symbol === WATCHLIST ? "any watchlist coin" : symbol}</b> prints a{" "}
            <b>{setupName(setup).toLowerCase()}</b> on <b>{interval}</b>
          </p>

          <fieldset className={styles.group}>
            <legend>Coin</legend>
            <div className={styles.pills}>
              {coins.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={styles.pill}
                  aria-pressed={c === symbol}
                  onClick={() => setSymbol(c)}
                >
                  {c}
                </button>
              ))}
              <button
                type="button"
                className={styles.pill}
                aria-pressed={symbol === WATCHLIST}
                onClick={() => setSymbol(WATCHLIST)}
              >
                Any watchlist coin
              </button>
            </div>
          </fieldset>

          <fieldset className={styles.group}>
            <legend>Setup</legend>
            <div className={styles.pills}>
              <label>
                <span className="sr-only">Pattern and direction</span>
                <select
                  value={`${setupInfo.pattern}|${setupInfo.direction}`}
                  onChange={(e) => {
                    const [pattern, d] = e.target.value.split("|");
                    setSetup(keyOf(pattern, d === "short" ? "short" : "long", "*"));
                  }}
                >
                  {patternChoices.length === 0 && (
                    <option value={`${setupInfo.pattern}|${setupInfo.direction}`}>
                      {patternLabel(setupInfo.pattern)}
                    </option>
                  )}
                  {patternChoices.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </fieldset>

          <fieldset className={styles.group}>
            <legend>Timeframe</legend>
            <div className={styles.pills}>
              {ALERT_INTERVALS.map((tf) => (
                <button
                  key={tf}
                  type="button"
                  className={styles.pill}
                  aria-pressed={tf === interval}
                  onClick={() => setTf(tf)}
                >
                  {tf}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className={styles.group}>
            <legend>Deliver to</legend>
            <div className={styles.checks}>
              <label>
                <input
                  type="checkbox"
                  checked={telegram}
                  onChange={(e) => setTelegram(e.target.checked)}
                />{" "}
                Telegram
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={inApp}
                  onChange={(e) => setInApp(e.target.checked)}
                />{" "}
                In-app banner
              </label>
            </div>
          </fieldset>

          <div className={styles.actions}>
            <button
              type="button"
              className={styles.primary}
              onClick={save}
              disabled={!telegram && !inApp}
            >
              Save alert
            </button>
            <button
              type="button"
              className={styles.btn}
              onClick={() => void sendTest()}
              disabled={test === "sending"}
            >
              {test === "sending" ? "Sending…" : "Send a test message"}
            </button>
          </div>
          {!telegram && !inApp && <p className={styles.mute}>Pick at least one way to be told.</p>}
          {saved && (
            <p className={styles.ok} role="status">
              {saved}
            </p>
          )}
          {test && test !== "sending" && (
            <p className={test === "sent" ? styles.ok : styles.warnText} role="status">
              {test === "sent"
                ? "Test message sent to Telegram."
                : test === "offline"
                  ? "The backend isn't reachable. Run npm run backend and try again."
                  : "The backend answered but Telegram didn't accept the message: check the bot token and chat id."}
            </p>
          )}
        </section>

        <div className={styles.side}>
          <section className={styles.card} aria-labelledby="active-title">
            <div className={styles.cardHead}>
              <h2 id="active-title">Active alerts</h2>
              <Chip tone="info">{alerts.rules.length}</Chip>
            </div>
            {alerts.rules.length === 0 ? (
              <p className={styles.mute}>No alerts yet. Build one on the left.</p>
            ) : (
              <ul className={styles.list}>
                {alerts.rules.map((r) => {
                  return (
                    <li key={r.id}>
                      <div className={styles.grow}>
                        <b>
                          {r.symbol === WATCHLIST ? "Watchlist" : r.symbol} ·{" "}
                          {setupName(r.setupKey)} · {r.interval}
                        </b>
                        <span className={styles.mute}>
                          {[r.telegram && "Telegram", r.inApp && "in-app"]
                            .filter(Boolean)
                            .join(" + ")}
                          {r.paused ? " · paused" : ""}
                        </span>
                      </div>
                      <button
                        type="button"
                        className={styles.btnSm}
                        onClick={() => svc.setPaused(r.id, !r.paused)}
                        aria-label={`${r.paused ? "Resume" : "Pause"} ${r.symbol} ${setupName(r.setupKey)} alert`}
                      >
                        {r.paused ? "Resume" : "Pause"}
                      </button>
                      <button
                        type="button"
                        className={styles.btnSm}
                        onClick={() => svc.removeRule(r.id)}
                        aria-label={`Delete ${r.symbol} ${setupName(r.setupKey)} alert`}
                      >
                        Delete
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className={styles.card} aria-labelledby="fired-title">
            <div className={styles.cardHead}>
              <h2 id="fired-title">Recent firings</h2>
              <p>
                {alerts.lastCheckAt
                  ? `Last checked ${when(alerts.lastCheckAt)}.`
                  : "Not checked yet this session."}
              </p>
            </div>
            {alerts.firings.length === 0 ? (
              <p className={styles.mute}>
                Nothing has fired yet. Alerts fire on candles that close after you save them.
              </p>
            ) : (
              <ul className={styles.list}>
                {alerts.firings.slice(0, 20).map((f) => (
                  <li key={f.id}>
                    <span className={`${styles.time} ${styles.num}`}>{when(f.time)}</span>
                    <div className={styles.grow}>
                      <Link to={`/chart/${f.symbol}`}>
                        {f.symbol} · {setupName(f.setupKey)}
                      </Link>
                      <span className={`${styles.mute} ${styles.num}`}>
                        {f.interval} · close {price(f.close)} · {f.score}/{f.of} checks
                        {f.met.length ? `: ${f.met.join("; ")}` : ""}
                      </span>
                    </div>
                    <Chip tone={DELIVERY[f.telegram].tone}>{DELIVERY[f.telegram].text}</Chip>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </main>
  );
};

export default AlertsPage;
