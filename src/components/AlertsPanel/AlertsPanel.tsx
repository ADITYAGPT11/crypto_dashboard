import { useEffect, useState, memo } from "react";
import { AlertService } from "../../services/AlertService";
import type { AlertCondition, AlertRule, AlertTrigger } from "../../types/alertRules";
import { CANDLE_INTERVALS, type CandleInterval } from "../../types/marketData";
import styles from "./AlertsPanel.module.scss";

interface Props {
  /** Watchlist symbols, offered in the rule form's symbol dropdown. */
  symbols: string[];
}

const EXCHANGES = ["BINANCE", "OKX", "DELTA"] as const;
const TYPES = ["SPOT", "FUT"] as const;
const KINDS = [
  "priceCross",
  "percentMove",
  "volumeSpike",
  "indicatorThreshold",
  "bookImbalance",
  "largeLiquidity",
] as const;

const KIND_LABELS: Record<(typeof KINDS)[number], string> = {
  priceCross: "Price crosses level",
  percentMove: "Percent move over N bars",
  volumeSpike: "Volume spike vs average",
  indicatorThreshold: "Indicator threshold (RSI/SMA/EMA)",
  bookImbalance: "Order-book imbalance",
  largeLiquidity: "Large visible resting order",
};

function newRuleId(): string {
  return `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function num(raw: string, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/** One-line human summary of a condition for the rules list. */
function describeCondition(c: AlertCondition): string {
  const target = `${c.symbol} ${c.type}`;
  switch (c.kind) {
    case "priceCross":
      return `${target}: cross ${c.direction} ${c.value}`;
    case "percentMove":
      return `${target}: ${c.direction} ${c.percent}% over ${c.window} bars (${c.interval})`;
    case "volumeSpike":
      return `${target}: volume ≥ ${c.multiplier}× mean of ${c.lookback} bars (${c.interval})`;
    case "indicatorThreshold":
      return `${target}: ${c.indicator.toUpperCase()}(${c.period}) ${c.operator} ${c.value} (${c.interval})`;
    case "bookImbalance":
      return `${target}: imbalance top ${c.topN} ${c.operator} ${c.threshold}`;
    case "largeLiquidity":
      return `${target}: visible level ≥ ${c.minQuantity}`;
  }
}

function formatClock(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const AlertsPanel: React.FC<Props> = ({ symbols }) => {
  // Plain singleton access (same pattern as the other hooks/services — no ref
  // is read during render).
  const service = AlertService.getInstance();

  const [rules, setRules] = useState<AlertRule[]>(() => service.getRules());
  const [log, setLog] = useState<AlertTrigger[]>(() => service.getTriggerLog());

  // Start the evaluation timer for the whole session (even if this panel is
  // later hidden — alerts keep evaluating).
  useEffect(() => {
    service.start();
    const onRules = () => setRules(service.getRules());
    const onLog = () => setLog(service.getTriggerLog());
    service.on("rulesChanged", onRules);
    service.on("logChanged", onLog);
    return () => {
      service.off("rulesChanged", onRules);
      service.off("logChanged", onLog);
    };
  }, [service]);

  // ---- rule draft state ----------------------------------------------------
  const [name, setName] = useState("");
  const [combine, setCombine] = useState<"ALL" | "ANY">("ALL");
  const [evaluation, setEvaluation] = useState<"candle_close" | "intrabar">("candle_close");
  const [cooldownSec, setCooldownSec] = useState(60);
  const [conditions, setConditions] = useState<AlertCondition[]>([]);

  // Draft condition fields (used according to the selected kind).
  const [kind, setKind] = useState<(typeof KINDS)[number]>("priceCross");
  const [symbol, setSymbol] = useState(symbols[0] ?? "BTC-USDT");
  const [exchange, setExchange] = useState<(typeof EXCHANGES)[number]>("BINANCE");
  const [mtype, setMtype] = useState<(typeof TYPES)[number]>("SPOT");
  const [interval, setIntervalSel] = useState<CandleInterval>("15m");
  const [direction, setDirection] = useState<"above" | "below" | "up" | "down" | "any">("below");
  const [value, setValue] = useState("0");
  const [windowBars, setWindowBars] = useState("3");
  const [lookback, setLookback] = useState("20");
  const [multiplier, setMultiplier] = useState("3");
  const [indicator, setIndicator] = useState<"rsi" | "sma" | "ema">("rsi");
  const [period, setPeriod] = useState("14");
  const [operator, setOperator] = useState<"<" | ">" | "<=" | ">=">(">");
  const [topN, setTopN] = useState("10");
  const [minQuantity, setMinQuantity] = useState("1");

  const buildCondition = (): AlertCondition | null => {
    const common = { exchange, type: mtype, symbol };
    switch (kind) {
      case "priceCross": {
        const v = num(value, 0);
        if (v <= 0) return null;
        return {
          kind: "priceCross",
          ...common,
          direction: direction === "below" ? "below" : "above",
          value: v,
        };
      }
      case "percentMove": {
        const v = num(value, 0);
        const w = Math.max(1, Math.round(num(windowBars, 1)));
        const dir = direction === "up" || direction === "down" ? direction : "any";
        if (v <= 0) return null;
        return { kind: "percentMove", ...common, interval, window: w, percent: v, direction: dir };
      }
      case "volumeSpike":
        return {
          kind: "volumeSpike",
          ...common,
          interval,
          lookback: Math.max(1, Math.round(num(lookback, 20))),
          multiplier: Math.max(1, num(multiplier, 3)),
        };
      case "indicatorThreshold":
        return {
          kind: "indicatorThreshold",
          ...common,
          interval,
          indicator,
          period: Math.max(2, Math.round(num(period, 14))),
          operator: operator === ">" || operator === "<=" || operator === ">=" ? operator : "<",
          value: num(value, 0),
        };
      case "bookImbalance":
        return {
          kind: "bookImbalance",
          ...common,
          topN: Math.max(1, Math.round(num(topN, 10))),
          operator: operator === "<" ? "<" : ">",
          threshold: num(value, 0.5),
        };
      case "largeLiquidity":
        return {
          kind: "largeLiquidity",
          ...common,
          minQuantity: Math.max(0, num(minQuantity, 1)),
        };
    }
  };

  const addCondition = () => {
    const cond = buildCondition();
    if (cond) setConditions((prev) => [...prev, cond]);
  };

  const createRule = () => {
    if (conditions.length === 0) return;
    service.addRule({
      id: newRuleId(),
      name: name.trim() || `${KIND_LABELS[kind]}`,
      enabled: true,
      combine,
      evaluation,
      cooldownMs: Math.max(1, Math.round(num(String(cooldownSec), 60))) * 1000,
      conditions,
      createdAt: Date.now(),
    });
    setConditions([]);
    setName("");
  };

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.title}>Alerts</span>
        <span className={styles.sub}>
          {rules.filter((r) => r.enabled).length}/{rules.length} enabled · evaluating every 2s
        </span>
      </div>

      <div className={styles.rulesList}>
        {rules.length === 0 && (
          <div className={styles.empty}>No alert rules yet — create one below.</div>
        )}
        {rules.map((r) => (
          <div key={r.id} className={`${styles.ruleRow} ${r.enabled ? "" : styles.ruleOff}`}>
            <div className={styles.ruleMain}>
              <span className={styles.ruleName}>{r.name}</span>
              <span className={styles.ruleMeta}>
                {r.combine} · {r.evaluation} · cooldown {Math.round(r.cooldownMs / 1000)}s
              </span>
              {r.conditions.map((c, i) => (
                <span key={i} className={styles.ruleCond}>
                  {describeCondition(c)}
                </span>
              ))}
            </div>
            <div className={styles.ruleActions}>
              <button
                type="button"
                className={styles.smallBtn}
                onClick={() => service.toggleRule(r.id)}
              >
                {r.enabled ? "On" : "Off"}
              </button>
              <button
                type="button"
                className={styles.smallBtn}
                onClick={() => service.removeRule(r.id)}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className={styles.form}>
        <div className={styles.formTitle}>New rule</div>
        <div className={styles.formRow}>
          <input
            className={styles.nameInput}
            placeholder="Rule name (optional)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
          />
          <select value={combine} onChange={(e) => setCombine(e.target.value as "ALL" | "ANY")}>
            <option value="ALL">ALL conditions</option>
            <option value="ANY">ANY condition</option>
          </select>
          <select
            value={evaluation}
            onChange={(e) => setEvaluation(e.target.value as "candle_close" | "intrabar")}
          >
            <option value="candle_close">on candle close</option>
            <option value="intrabar">intrabar</option>
          </select>
          <label className={styles.cooldownLabel}>
            cooldown
            <input
              type="number"
              min={1}
              value={cooldownSec}
              onChange={(e) => setCooldownSec(num(e.target.value, 60))}
            />
            s
          </label>
        </div>

        <div className={styles.formRow}>
          <select value={kind} onChange={(e) => setKind(e.target.value as (typeof KINDS)[number])}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>
          <select value={symbol} onChange={(e) => setSymbol(e.target.value)}>
            {(symbols.includes(symbol) ? symbols : [symbol, ...symbols]).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select value={exchange} onChange={(e) => setExchange(e.target.value as never)}>
            {EXCHANGES.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
          <select value={mtype} onChange={(e) => setMtype(e.target.value as never)}>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          {(kind === "percentMove" || kind === "volumeSpike" || kind === "indicatorThreshold") && (
            <select
              value={interval}
              onChange={(e) => setIntervalSel(e.target.value as CandleInterval)}
            >
              {CANDLE_INTERVALS.map((iv) => (
                <option key={iv} value={iv}>
                  {iv}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className={styles.formRow}>
          {(kind === "priceCross" || kind === "percentMove") && (
            <select value={direction} onChange={(e) => setDirection(e.target.value as never)}>
              {kind === "priceCross" ? (
                <>
                  <option value="above">cross above</option>
                  <option value="below">cross below</option>
                </>
              ) : (
                <>
                  <option value="any">any direction</option>
                  <option value="up">up</option>
                  <option value="down">down</option>
                </>
              )}
            </select>
          )}
          {(kind === "priceCross" ||
            kind === "percentMove" ||
            kind === "indicatorThreshold" ||
            kind === "bookImbalance") && (
            <input
              type="number"
              placeholder={
                kind === "indicatorThreshold"
                  ? "threshold"
                  : kind === "bookImbalance"
                    ? "imbalance (-1…1)"
                    : "value"
              }
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          )}
          {kind === "percentMove" && (
            <input
              type="number"
              min={1}
              placeholder="bars back"
              value={windowBars}
              onChange={(e) => setWindowBars(e.target.value)}
            />
          )}
          {kind === "volumeSpike" && (
            <>
              <input
                type="number"
                min={1}
                placeholder="lookback bars"
                value={lookback}
                onChange={(e) => setLookback(e.target.value)}
              />
              <input
                type="number"
                min={1}
                placeholder="× avg volume"
                value={multiplier}
                onChange={(e) => setMultiplier(e.target.value)}
              />
            </>
          )}
          {kind === "indicatorThreshold" && (
            <>
              <select
                value={indicator}
                onChange={(e) => setIndicator(e.target.value as "rsi" | "sma" | "ema")}
              >
                <option value="rsi">RSI</option>
                <option value="sma">SMA</option>
                <option value="ema">EMA</option>
              </select>
              <input
                type="number"
                min={2}
                placeholder="period"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
              />
              <select value={operator} onChange={(e) => setOperator(e.target.value as never)}>
                <option value="<">&lt;</option>
                <option value=">">&gt;</option>
                <option value="<=">≤</option>
                <option value=">=">≥</option>
              </select>
            </>
          )}
          {kind === "bookImbalance" && (
            <>
              <input
                type="number"
                min={1}
                placeholder="top N"
                value={topN}
                onChange={(e) => setTopN(e.target.value)}
              />
              <select
                value={operator === "<" ? "<" : ">"}
                onChange={(e) => setOperator(e.target.value as never)}
              >
                <option value=">">&gt; (bids dominate)</option>
                <option value="<">&lt; (asks dominate)</option>
              </select>
            </>
          )}
          {kind === "largeLiquidity" && (
            <input
              type="number"
              min={0}
              placeholder="min qty (base units)"
              value={minQuantity}
              onChange={(e) => setMinQuantity(e.target.value)}
            />
          )}
          <button type="button" className={styles.addBtn} onClick={addCondition}>
            + Add condition
          </button>
        </div>

        {conditions.length > 0 && (
          <div className={styles.draftConds}>
            {conditions.map((c, i) => (
              <span key={i} className={styles.draftCond}>
                {describeCondition(c)}
                <button
                  type="button"
                  onClick={() => setConditions((prev) => prev.filter((_, j) => j !== i))}
                  aria-label="Remove condition"
                >
                  ✕
                </button>
              </span>
            ))}
            <button
              type="button"
              className={styles.createBtn}
              onClick={createRule}
              disabled={name.trim().length === 0 && conditions.length === 0}
            >
              Create rule
            </button>
          </div>
        )}
      </div>

      <div className={styles.logSection}>
        <div className={styles.formTitle}>Recent triggers</div>
        {log.length === 0 && <div className={styles.empty}>Nothing fired yet.</div>}
        {log
          .slice(0, 20)
          .reverse()
          .map((t, i) => (
            <div key={i} className={styles.logRow}>
              <span className={styles.logTime}>{formatClock(t.firedAt)}</span>
              <span className={styles.logName}>{t.ruleName}</span>
              <span className={styles.logReason}>{t.reason}</span>
            </div>
          ))}
      </div>
    </div>
  );
};

export default memo(AlertsPanel);
