/**
 * Setup alerts: "tell me when [coin] prints a [setup] on [timeframe]".
 *
 * Pure rule matching and storage parsing; the live wiring is
 * `services/SetupAlertService.ts`. An alert fires once per occurrence, only for
 * candles that closed after the rule was created ("next time", not history),
 * and carries the setup's pooled record so the message is evidence, not a bare signal.
 */
import type { CandleInterval } from "../types/marketData";
import type { OutcomeResult, Verdict } from "../types/analysis";
import type { AlertTrigger } from "../types/alertRules";
import { LOCATION_LABELS } from "./setupAnalysis";
import { PATTERN_LABELS } from "./patterns";
import type { CurrentSetup, Scan } from "./setupAnalysis";
import { setupKey } from "./setupAnalysis";
import { parseSetupKey } from "./setupLibrary";

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
  /** Fire only while the pooled verdict is "edge". */
  edgeOnly: boolean;
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
  entry: number;
  stop: number;
  target: number;
  record: { n: number; wins: number; winRate: number; ci: [number, number]; verdict: Verdict };
  outcome: OutcomeResult;
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
    for (const { occurrence: o, pooled } of current) {
      const key = setupKey(o.hit.type, o.location);
      if (key !== rule.setupKey || !ruleCovers(rule, o.symbol, watchlist)) continue;
      if (o.time + ms < rule.createdAt) continue; // closed before the rule existed
      if (rule.edgeOnly && pooled.verdict !== "edge") continue;
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
        entry: o.hit.entry,
        stop: o.hit.stop,
        target: o.hit.target,
        record: {
          n: pooled.n,
          wins: pooled.wins,
          winRate: pooled.winRate,
          ci: pooled.ci,
          verdict: pooled.verdict,
        },
        outcome: o.outcome.result,
        telegram: rule.telegram ? "offline" : "off",
        unseen: rule.inApp,
      });
    }
  }
  return out;
}

/** The latest outcome of a fired setup, read from a newer scan (unchanged if not found). */
export function resolveOutcome(firing: SetupAlertFiring, scan: Scan): OutcomeResult {
  const occ = scan.analyses
    .get(firing.symbol)
    ?.occurrences.find(
      (o) => o.time === firing.time && setupKey(o.hit.type, o.location) === firing.setupKey,
    );
  return occ?.outcome.result ?? firing.outcome;
}

/** "Double bottom in demand zone" for a valid key, the raw key otherwise. */
export function setupName(key: string): string {
  const s = parseSetupKey(key);
  return s ? `${PATTERN_LABELS[s.type]} ${LOCATION_LABELS[s.location]}` : key;
}

const VERDICT_TEXT: Record<Verdict, string> = {
  edge: "edge candidate (gross, not yet cost-tested)",
  noEdge: "no edge: the range overlaps break-even",
  tooFew: "too few cases for a verdict",
};

function pctText(v: number): string {
  return `${Math.round(v * 100)}%`;
}

/** The backend's Telegram payload for a firing: the setup, the plan and its record. */
export function toTrigger(f: SetupAlertFiring): AlertTrigger {
  const r = f.record;
  return {
    ruleId: f.ruleId,
    ruleName: `${f.symbol} · ${setupName(f.setupKey)} · ${f.interval}`,
    firedAt: f.firedAt,
    values: {
      entry: String(f.entry),
      stop: String(f.stop),
      target: String(f.target),
      record: `${r.wins} of ${r.n} won (${pctText(r.winRate)}, 95% range ${pctText(r.ci[0])}–${pctText(r.ci[1])})`,
      verdict: VERDICT_TEXT[r.verdict],
    },
    reason: `${f.symbol} printed a ${setupName(f.setupKey).toLowerCase()} on a closed ${f.interval} candle. Past record is before fees; you decide and trade.`,
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
    const key = typeof v.setupKey === "string" ? v.setupKey : null;
    if (!tf || !parseSetupKey(key)) continue;
    if (v.symbol !== WATCHLIST && !SYMBOL_FORMAT.test(v.symbol)) continue;
    if (out.some((r) => r.id === v.id)) continue;
    out.push({
      id: v.id,
      symbol: v.symbol,
      setupKey: key!,
      interval: tf,
      telegram: v.telegram === true,
      inApp: v.inApp !== false,
      edgeOnly: v.edgeOnly === true,
      paused: v.paused === true,
      createdAt: typeof v.createdAt === "number" ? v.createdAt : 0,
    });
    if (out.length >= MAX_RULES) break;
  }
  return out;
}

const OUTCOMES: readonly OutcomeResult[] = ["win", "loss", "expired", "open"];
const VERDICTS: readonly Verdict[] = ["edge", "noEdge", "tooFew"];
const DELIVERIES: readonly Delivery[] = ["sent", "failed", "offline", "off"];

export function parseFirings(value: unknown): SetupAlertFiring[] {
  if (!Array.isArray(value)) return [];
  const out: SetupAlertFiring[] = [];
  for (const raw of value) {
    const v = obj(raw);
    const rec = obj(v?.record);
    if (!v || !rec) continue;
    const tf = interval(v.interval);
    const nums = [v.time, v.firedAt, v.entry, v.stop, v.target, rec.n, rec.wins, rec.winRate];
    if (!tf || nums.some((n) => typeof n !== "number" || !Number.isFinite(n))) continue;
    if (typeof v.id !== "string" || typeof v.ruleId !== "string") continue;
    if (typeof v.symbol !== "string" || typeof v.setupKey !== "string") continue;
    if (!parseSetupKey(v.setupKey)) continue;
    const ci = Array.isArray(rec.ci) && rec.ci.length === 2 ? rec.ci : null;
    if (!ci || ci.some((n) => typeof n !== "number")) continue;
    out.push({
      id: v.id,
      ruleId: v.ruleId,
      symbol: v.symbol,
      setupKey: v.setupKey,
      interval: tf,
      time: v.time as number,
      firedAt: v.firedAt as number,
      entry: v.entry as number,
      stop: v.stop as number,
      target: v.target as number,
      record: {
        n: rec.n as number,
        wins: rec.wins as number,
        winRate: rec.winRate as number,
        ci: [ci[0] as number, ci[1] as number],
        verdict: VERDICTS.find((x) => x === rec.verdict) ?? "tooFew",
      },
      outcome: OUTCOMES.find((x) => x === v.outcome) ?? "open",
      telegram: DELIVERIES.find((x) => x === v.telegram) ?? "off",
      unseen: v.unseen === true,
    });
    if (out.length >= MAX_FIRINGS) break;
  }
  return out;
}
