/**
 * Alert-rule + trigger-log persistence (Module 6).
 *
 * The rule format lives in src/types/alertRules.ts; this module validates,
 * loads and saves rules (and fired-trigger logs) in localStorage. Parsing is
 * pure and unit-testable; only load()/save() touch storage.
 */
import type { AlertCondition, AlertRule, AlertTrigger } from "../types/alertRules";

export const ALERT_RULES_STORAGE_KEY = "alerts:rules";
export const ALERT_LOG_STORAGE_KEY = "alerts:triggerLog";

/** Storage facade for backward compatibility */
export const alertRulesStorage = {
  loadRules: loadAlertRules,
  saveRules: (rules: AlertRule[]) => saveAlertRules(rules),
  loadTriggerLog,
  saveTriggerLog: (triggers: AlertTrigger[], log: AlertTrigger[]) => saveTriggerLog(triggers, log),
};

const MAX_RULES = 50;
const MAX_LOG_ENTRIES = 100;

const EXCHANGES = ["BINANCE", "OKX", "DELTA"] as const;
const TYPES = ["SPOT", "FUT"] as const;
const INTERVALS = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;

function isExchange(v: unknown): v is (typeof EXCHANGES)[number] {
  return typeof v === "string" && (EXCHANGES as readonly string[]).includes(v);
}
function isType(v: unknown): v is (typeof TYPES)[number] {
  return typeof v === "string" && (TYPES as readonly string[]).includes(v);
}
function isInterval(v: unknown): v is (typeof INTERVALS)[number] {
  return typeof v === "string" && (INTERVALS as readonly string[]).includes(v);
}
function isSymbol(v: unknown): v is string {
  return typeof v === "string" && /^[A-Z0-9]+-[A-Z0-9]+$/.test(v);
}
function isFiniteNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}
const asExchange = (v: unknown) => (isExchange(v) ? v : null);
const asType = (v: unknown) => (isType(v) ? v : null);
const asInterval = (v: unknown) => (isInterval(v) ? v : null);
const asSymbol = (v: unknown) => (isSymbol(v) ? v : null);
const asPick =
  <T extends string>(allowed: readonly T[]) =>
  (v: unknown): T | null =>
    typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : null;
export const pickCombine = asPick(["ALL", "ANY"] as const);

/** Validate one condition; returns a clean copy or null. */
export function parseCondition(value: unknown): AlertCondition | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const exchange = asExchange(v.exchange);
  const type = asType(v.type);
  const symbol = asSymbol(v.symbol);
  if (!exchange || !type || !symbol) return null;

  const common = { exchange, type, symbol };
  switch (v.kind) {
    case "priceCross": {
      const direction = asPick(["above", "below"] as const)(v.direction);
      if (direction && isFiniteNum(v.value))
        return { kind: "priceCross", ...common, direction, value: v.value };
      return null;
    }
    case "percentMove": {
      const interval = asInterval(v.interval);
      const direction = asPick(["up", "down", "any"] as const)(v.direction);
      if (
        interval &&
        direction &&
        isFiniteNum(v.percent) &&
        isFiniteNum(v.window) &&
        v.window >= 1
      ) {
        return {
          kind: "percentMove",
          ...common,
          interval,
          window: Math.round(v.window),
          percent: v.percent,
          direction,
        };
      }
      return null;
    }
    case "volumeSpike": {
      const interval = asInterval(v.interval);
      if (interval && isFiniteNum(v.multiplier) && isFiniteNum(v.lookback) && v.lookback >= 1) {
        return {
          kind: "volumeSpike",
          ...common,
          interval,
          lookback: Math.round(v.lookback),
          multiplier: v.multiplier,
        };
      }
      return null;
    }
    case "indicatorThreshold": {
      const interval = asInterval(v.interval);
      const indicator = asPick(["rsi", "sma", "ema"] as const)(v.indicator);
      const operator = asPick(["<", ">", "<=", ">="] as const)(v.operator);
      if (
        interval &&
        indicator &&
        operator &&
        isFiniteNum(v.period) &&
        v.period >= 2 &&
        isFiniteNum(v.value)
      ) {
        return {
          kind: "indicatorThreshold",
          ...common,
          interval,
          indicator,
          period: Math.round(v.period),
          operator,
          value: v.value,
        };
      }
      return null;
    }
    case "bookImbalance": {
      const operator = asPick(["<", ">"] as const)(v.operator);
      if (operator && isFiniteNum(v.topN) && v.topN >= 1 && isFiniteNum(v.threshold)) {
        return {
          kind: "bookImbalance",
          ...common,
          topN: Math.round(v.topN),
          operator,
          threshold: v.threshold,
        };
      }
      return null;
    }
    case "largeLiquidity": {
      if (isFiniteNum(v.minQuantity) && v.minQuantity >= 0) {
        return { kind: "largeLiquidity", ...common, minQuantity: v.minQuantity };
      }
      return null;
    }
    default:
      return null;
  }
}

/** Validate/coerce an unknown parsed value into a clean rule list. */
export function parseAlertRules(value: unknown): AlertRule[] {
  const result: AlertRule[] = [];
  if (!Array.isArray(value)) return result;
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const v = entry as Record<string, unknown>;
    if (typeof v.id !== "string" || v.id.length === 0 || v.id.length > 64) continue;
    if (typeof v.name !== "string" || v.name.trim().length === 0 || v.name.length > 80) continue;
    const combine = asPick(["ALL", "ANY"] as const)(v.combine) ?? "ALL";
    const evaluation = asPick(["candle_close", "intrabar"] as const)(v.evaluation) ?? "intrabar";
    const cooldownMs = isFiniteNum(v.cooldownMs)
      ? Math.max(1000, Math.round(v.cooldownMs))
      : 60_000;
    const conditions = Array.isArray(v.conditions)
      ? (v.conditions
          .map(parseCondition)
          .filter((c): c is AlertCondition => c !== null) as AlertCondition[])
      : [];
    if (conditions.length === 0) continue; // a rule without valid conditions is unusable
    result.push({
      id: v.id,
      name: v.name.trim(),
      enabled: v.enabled === true,
      combine,
      evaluation,
      cooldownMs,
      conditions,
      createdAt: isFiniteNum(v.createdAt) ? v.createdAt : Date.now(),
    });
    if (result.length >= MAX_RULES) break;
  }
  return result;
}

export function readStoredAlertRules(raw: string | null | undefined): AlertRule[] {
  if (typeof raw !== "string") return [];
  try {
    return parseAlertRules(JSON.parse(raw) as unknown);
  } catch {
    return [];
  }
}

export function loadAlertRules(
  storage: Pick<Storage, "getItem"> | undefined = typeof localStorage === "undefined"
    ? undefined
    : localStorage,
): AlertRule[] {
  return readStoredAlertRules(storage?.getItem(ALERT_RULES_STORAGE_KEY));
}

export function saveAlertRules(
  rules: AlertRule[],
  storage: Pick<Storage, "setItem"> | undefined = typeof localStorage === "undefined"
    ? undefined
    : localStorage,
): void {
  if (!storage) return;
  try {
    storage.setItem(ALERT_RULES_STORAGE_KEY, JSON.stringify(parseAlertRules(rules)));
  } catch (error) {
    console.error("Failed to persist alert rules:", error);
  }
}

/**
 * Parse the fired-trigger log (newest entries kept, capped at MAX_LOG_ENTRIES).
 * Entry shape: { at, ruleId, ruleName, reason, values }.
 */
export function parseTriggerLog(value: unknown): AlertTrigger[] {
  if (!Array.isArray(value)) return [];
  const result: AlertTrigger[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const v = entry as Record<string, unknown>;
    if (typeof v.ruleId !== "string") continue;
    if (typeof v.ruleName !== "string" || typeof v.reason !== "string") continue;
    if (!isFiniteNum(v.firedAt)) continue;
    const values: Record<string, string> = {};
    if (typeof v.values === "object" && v.values !== null) {
      for (const [k, x] of Object.entries(v.values)) {
        if (typeof x === "string") values[k] = x;
      }
    }
    result.push({
      ruleId: v.ruleId,
      ruleName: v.ruleName,
      firedAt: v.firedAt,
      values,
      reason: v.reason,
    });
    if (result.length >= MAX_LOG_ENTRIES) break;
  }
  return result;
}

export function readStoredTriggerLog(raw: string | null | undefined): AlertTrigger[] {
  if (typeof raw !== "string") return [];
  try {
    return parseTriggerLog(JSON.parse(raw) as unknown);
  } catch {
    return [];
  }
}

/** Append a trigger to the persisted log (newest first, capped). */
export function saveTriggerLog(
  triggers: AlertTrigger[],
  log: AlertTrigger[],
  storage: Pick<Storage, "getItem" | "setItem"> | undefined = typeof localStorage === "undefined"
    ? undefined
    : localStorage,
): AlertTrigger[] {
  const next = [...log, ...triggers].slice(0, MAX_LOG_ENTRIES);
  if (storage) {
    try {
      storage.setItem(ALERT_LOG_STORAGE_KEY, JSON.stringify(next));
    } catch (error) {
      console.error("Failed to persist alert trigger log:", error);
    }
  }
  return next;
}

export function loadTriggerLog(
  storage: Pick<Storage, "getItem"> | undefined = typeof localStorage === "undefined"
    ? undefined
    : localStorage,
): AlertTrigger[] {
  return readStoredTriggerLog(storage?.getItem(ALERT_LOG_STORAGE_KEY));
}
