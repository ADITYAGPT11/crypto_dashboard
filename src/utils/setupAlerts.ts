/**
 * Setup alerts: "tell me when [coin] prints a [setup] on [timeframe]".
 *
 * Pure rule matching and storage parsing; the live wiring is
 * `services/SetupAlertService.ts`. An alert fires once per occurrence, only for
 * candles that closed after the rule was created ("next time", not history),
 * and carries the setup's checklist (what was met at the confirmation candle).
 */
import type { CandleInterval } from "../types/marketData";
import type { SetupOccurrence } from "../types/analysis";
import type { AlertTrigger } from "../types/alertRules";
import { patternLabel } from "./patternLabels";
import { locationLabel, normalizeSetupKey, parseSetupKey, setupKey } from "./setupKeys";

/** A setup confirmed on a recent closed candle. */
export interface CurrentSetup {
  occurrence: SetupOccurrence;
}

/** Rule symbol meaning "any coin on my watchlist". */
export const WATCHLIST = "WATCHLIST";

export const ALERT_INTERVALS: readonly CandleInterval[] = ["1h", "4h", "1d"];

const INTERVAL_MS: Record<string, number> = { "1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000 };

export interface SetupAlertRule {
  id: string;
  /** Canonical symbol (BTC-USDT) or WATCHLIST. */
  symbol: string;
  setupKey: string;
  interval: CandleInterval;
  telegram: boolean;
  inApp: boolean;
  paused: boolean;
  createdAt: number;
}

export type Delivery = "sent" | "failed" | "offline" | "off";

export interface SetupAlertFiring {
  /** ruleId|symbol|confirmation candle time: one firing per occurrence. */
  id: string;
  ruleId: string;
  symbol: string;
  setupKey: string;
  interval: CandleInterval;
  /** Open time (ms) of the confirmation candle. */
  time: number;
  firedAt: number;
  /** Close of the confirmation candle. */
  close: number;
  /** Checklist items met, out of `of`; `met` = their labels. */
  score: number;
  of: number;
  met: string[];
  telegram: Delivery;
  /** Shown in the in-app banner until dismissed. */
  unseen: boolean;
}

export const MAX_RULES = 50;
export const MAX_FIRINGS = 100;

export function newRuleId(now: number, rand: () => number = Math.random): string {
  return `sa_${now.toString(36)}_${Math.floor(rand() * 1e9).toString(36)}`;
}

function ruleCovers(rule: SetupAlertRule, symbol: string, watchlist: readonly string[]): boolean {
  return rule.symbol === WATCHLIST ? watchlist.includes(symbol) : rule.symbol === symbol;
}

/**
 * New firings for setups detected now. `known` holds ids already fired so a setup
 * fires once even though it stays "current" for a few candles.
 */
export function matchFirings(
  rules: readonly SetupAlertRule[],
  current: readonly CurrentSetup[],
  interval: CandleInterval,
  watchlist: readonly string[],
  known: ReadonlySet<string>,
  now: number,
): SetupAlertFiring[] {
  const ms = INTERVAL_MS[interval];
  const out: SetupAlertFiring[] = [];
  for (const rule of rules) {
    if (rule.paused || rule.interval !== interval) continue;
    const want = parseSetupKey(rule.setupKey);
    if (!want) continue;
    for (const { occurrence: o } of current) {
      const key = setupKey(o.pattern, o.direction, o.location);
      const matches =
        o.pattern === want.pattern &&
        o.direction === want.direction &&
        (want.location === "*" || o.location === want.location);
      if (!matches || !ruleCovers(rule, o.symbol, watchlist)) continue;
      if (o.time + ms < rule.createdAt) continue; // closed before the rule existed
      const id = `${rule.id}|${o.symbol}|${o.time}`;
      if (known.has(id) || out.some((f) => f.id === id)) continue;
      out.push({
        id,
        ruleId: rule.id,
        symbol: o.symbol,
        setupKey: key,
        interval,
        time: o.time,
        firedAt: now,
        close: o.close,
        score: o.score,
        of: o.checks.length,
        met: o.checks.filter((c) => c.passed).map((c) => c.label),
        telegram: rule.telegram ? "offline" : "off",
        unseen: rule.inApp,
      });
    }
  }
  return out;
}

/** "Long double bottom" (plus its location on rules saved before r5's UI) or the raw key. */
export function setupName(key: string): string {
  const s = parseSetupKey(key);
  return s
    ? `${s.direction === "long" ? "Long" : "Short"} ${patternLabel(s.pattern).toLowerCase()} ${locationLabel(s.location, s.direction)}`.trimEnd()
    : key;
}

/** The backend's Telegram payload for a firing: the setup and its checklist. */
export function toTrigger(f: SetupAlertFiring): AlertTrigger {
  return {
    ruleId: f.ruleId,
    ruleName: `${f.symbol} · ${setupName(f.setupKey)} · ${f.interval}`,
    firedAt: f.firedAt,
    values: {
      close: String(f.close),
      checks: `${f.score}/${f.of}`,
      met: f.met.join("; ") || "none",
    },
    reason: `${f.symbol} printed a ${setupName(f.setupKey).toLowerCase()} setup on a closed ${f.interval} candle. The checklist describes where it formed; it is not a prediction. You decide and trade.`,
  };
}

// ----------------------------------------------------------------------------
// Storage parsing (localStorage in Phase 1a; the backend owns rules in 1b)
// ----------------------------------------------------------------------------

export const RULES_STORAGE_KEY = "setupAlerts:rules";
export const FIRINGS_STORAGE_KEY = "setupAlerts:firings";

const SYMBOL_FORMAT = /^[A-Z0-9]{1,15}-[A-Z0-9]{1,10}$/;

function obj(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
}

function interval(v: unknown): CandleInterval | null {
  return ALERT_INTERVALS.find((i) => i === v) ?? null;
}

export function parseRules(value: unknown): SetupAlertRule[] {
  if (!Array.isArray(value)) return [];
  const out: SetupAlertRule[] = [];
  for (const raw of value) {
    const v = obj(raw);
    if (!v || typeof v.id !== "string" || typeof v.symbol !== "string") continue;
    const tf = interval(v.interval);
    const key = typeof v.setupKey === "string" ? normalizeSetupKey(v.setupKey) : null;
    if (!tf || !key) continue;
    if (v.symbol !== WATCHLIST && !SYMBOL_FORMAT.test(v.symbol)) continue;
    if (out.some((r) => r.id === v.id)) continue;
    out.push({
      id: v.id,
      symbol: v.symbol,
      setupKey: key,
      interval: tf,
      telegram: v.telegram === true,
      inApp: v.inApp !== false,
      paused: v.paused === true,
      createdAt: typeof v.createdAt === "number" ? v.createdAt : 0,
    });
    if (out.length >= MAX_RULES) break;
  }
  return out;
}

const DELIVERIES: readonly Delivery[] = ["sent", "failed", "offline", "off"];

export function parseFirings(value: unknown): SetupAlertFiring[] {
  if (!Array.isArray(value)) return [];
  const out: SetupAlertFiring[] = [];
  for (const raw of value) {
    const v = obj(raw);
    if (!v) continue;
    const tf = interval(v.interval);
    const nums = [v.time, v.firedAt];
    if (!tf || nums.some((n) => typeof n !== "number" || !Number.isFinite(n))) continue;
    if (typeof v.id !== "string" || typeof v.ruleId !== "string") continue;
    if (typeof v.symbol !== "string" || typeof v.setupKey !== "string") continue;
    const setupKeyNow = normalizeSetupKey(v.setupKey);
    if (!setupKeyNow) continue;
    out.push({
      id: v.id,
      ruleId: v.ruleId,
      symbol: v.symbol,
      setupKey: setupKeyNow,
      interval: tf,
      time: v.time as number,
      firedAt: v.firedAt as number,
      // Firings stored before the checklist (with a trade plan) keep their time and setup only.
      close: typeof v.close === "number" && Number.isFinite(v.close) ? v.close : 0,
      score: typeof v.score === "number" ? v.score : 0,
      of: typeof v.of === "number" ? v.of : 0,
      met: Array.isArray(v.met) ? v.met.filter((m): m is string => typeof m === "string") : [],
      telegram: DELIVERIES.find((x) => x === v.telegram) ?? "off",
      unseen: v.unseen === true,
    });
    if (out.length >= MAX_FIRINGS) break;
  }
  return out;
}
