import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useCatalog, useStats } from "../../custom-hooks/useAnalysisApi";
import { useSetupAlerts } from "../../custom-hooks/useSetupAlerts";
import { SetupAlertService, type TelegramStatus } from "../../services/SetupAlertService";
import { LOCATIONS, locationLabel, parseSetupKey, setupKey as keyOf } from "../../utils/setupKeys";
import { patternLabel } from "../../utils/patternLabels";
import { statsByKey } from "../../utils/setupLibrary";
import {
  ALERT_INTERVALS,
  setupName,
  WATCHLIST,
  type Delivery,
  type SetupAlertFiring,
} from "../../utils/setupAlerts";
import { loadWatchlist } from "../../utils/watchlistStorage";
import { pct, price } from "../../utils/format";
import type { Direction, LocationFilter } from "../../types/analysis";
import type { CandleInterval } from "../../types/marketData";
import { Chip, CiBar, Explain, VerdictChip } from "../../common-components/Evidence";
import { BRAND } from "../../brand";
import styles from "./AlertsPage.module.scss";

const LOCATION_CHOICES: readonly LocationFilter[] = ["*", ...LOCATIONS];

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

const OUTCOME: Record<SetupAlertFiring["outcome"], { tone: "up" | "down" | "lock"; text: string }> =
  {
    win: { tone: "up", text: "Target hit" },
    loss: { tone: "down", text: "Stopped" },
    expired: { tone: "lock", text: "Expired" },
    open: { tone: "lock", text: "Open" },
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
  const [setup, setSetup] = useState(
    initialSetup
      ? keyOf(initialSetup.pattern, initialSetup.direction, initialSetup.location)
      : keyOf("doubleBottom", "long", "*"),
  );
  const setupInfo = parseSetupKey(setup) ?? {
    pattern: "doubleBottom",
    direction: "long" as Direction,
    location: "*" as LocationFilter,
  };
  const catalog = useCatalog().data;
  const patternChoices = useMemo(
    () =>
      (catalog?.patterns ?? []).flatMap((p) =>
        (p.bias === "either" ? (["long", "short"] as const) : [p.bias]).map((d) => ({
          value: `${p.id}|${d}`,
          label: `${d === "long" ? "▲" : "▼"} ${p.label}${p.bias === "either" ? (d === "long" ? " (up)" : " (down)") : ""}`,
        })),
      ),
    [catalog],
  );
  const [interval, setTf] = useState<CandleInterval>(
    ALERT_INTERVALS.find((i) => i === params.get("tf")) ?? "4h",
  );
  const [telegram, setTelegram] = useState(true);
  const [inApp, setInApp] = useState(true);
  const [edgeOnly, setEdgeOnly] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [test, setTest] = useState<Delivery | "sending" | null>(null);

  const coins = useMemo(() => [...new Set([symbol, ...watchlist])], [symbol, watchlist]);
  const statsRes = useStats(interval, interval);
  const loading = statsRes.data === null && statsRes.error === null;
  const pooledMap = useMemo(() => statsByKey(statsRes.data), [statsRes.data]);
  const record = pooledMap.get(setup) ?? null;

  const save = () => {
    const rule = svc.addRule({ symbol, setupKey: setup, interval, telegram, inApp, edgeOnly });
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
            Get told when a setup prints, with its track record attached, so you decide on evidence
            instead of a bare signal.
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
                    setSetup(keyOf(pattern, d === "short" ? "short" : "long", setupInfo.location));
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
              <label>
                <span className="sr-only">Location</span>
                <select
                  value={setupInfo.location}
                  onChange={(e) =>
                    setSetup(
                      keyOf(
                        setupInfo.pattern,
                        setupInfo.direction,
                        LOCATION_CHOICES.find((l) => l === e.target.value) ?? "*",
                      ),
                    )
                  }
                >
                  {LOCATION_CHOICES.map((l) => (
                    <option key={l} value={l}>
                      {locationLabel(l, setupInfo.direction)}
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

          <div className={styles.record} aria-live="polite">
            <b>
              The record you'd be alerted on{" "}
              <Explain title="Why show the record">
                Every alert carries the setup's pooled history across coins on this timeframe, so a
                "no edge" or "too few cases" setup is labelled as such in the message itself.
              </Explain>
            </b>
            {record && record.n > 0 ? (
              <>
                <div className={styles.recordTop}>
                  <span className={styles.big}>{pct(record.winRate)}</span>
                  <span className={`${styles.mute} ${styles.num}`}>
                    {record.wins} of {record.n} · range {pct(record.ci[0])}–{pct(record.ci[1])} ·
                    break-even {pct(record.breakEven)}
                  </span>
                  <VerdictChip verdict={record.verdict} />
                </div>
                <CiBar stats={record} />
                <span className={styles.mute}>
                  {record.verdict === "edge"
                    ? "Whole range sits above break-even. Still gross, and not yet backtested with costs."
                    : record.verdict === "noEdge"
                      ? "The range overlaps break-even: this setup hasn't shown an edge. The alert will say so."
                      : "Fewer than 30 resolved cases: the true win rate could be anywhere in that wide range."}
                </span>
              </>
            ) : (
              <span className={styles.mute}>
                {loading
                  ? `Loading the record of ${patternLabel(setupInfo.pattern).toLowerCase()} on ${interval}…`
                  : `No resolved cases of this setup on ${interval} yet, so the alert would arrive without a track record.`}
              </span>
            )}
          </div>

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
              <label>
                <input
                  type="checkbox"
                  checked={edgeOnly}
                  onChange={(e) => setEdgeOnly(e.target.checked)}
                />{" "}
                Only while the verdict is edge candidate
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
                  const rec = r.interval === interval ? pooledMap.get(r.setupKey) : undefined;
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
                          {r.edgeOnly ? " · edge only" : ""}
                          {rec
                            ? ` · ${pct(rec.ci[0])}–${pct(rec.ci[1])} vs BE ${pct(rec.breakEven)}`
                            : ""}
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
              <h2 id="fired-title">Recent firings and what happened</h2>
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
                        {f.interval} · entry {price(f.entry)} · stop {price(f.stop)} · target{" "}
                        {price(f.target)}
                      </span>
                    </div>
                    <Chip tone={OUTCOME[f.outcome].tone}>{OUTCOME[f.outcome].text}</Chip>
                    <Chip tone={DELIVERY[f.telegram].tone}>{DELIVERY[f.telegram].text}</Chip>
                  </li>
                ))}
              </ul>
            )}
            <p className={styles.note}>
              Every fired alert is tracked to its outcome, so your own alerts become forward-test
              data.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
};

export default AlertsPage;
