/**
 * Position sizing for a planned trade: pure maths, no exchange calls.
 *
 * Size is chosen so that a stop-out loses `riskPct` of the account before fees;
 * fees are then added on top so the loss at the stop is stated honestly.
 * Direction follows the plan: a stop below entry is a long, above entry a short.
 */

export interface RiskInput {
  account: number;
  /** Percent of the account to lose if the stop is hit (e.g. 1 = 1%). */
  riskPct: number;
  entry: number;
  stop: number;
  target: number;
  /** Fee per side in percent of notional (e.g. 0.05 = 0.05%). */
  feePct: number;
}

export interface Position {
  direction: "long" | "short";
  riskAmount: number;
  /** Absolute price distance entry → stop, and as a percent of entry. */
  stopDistance: number;
  stopPct: number;
  quantity: number;
  notional: number;
  /** Notional divided by account; above 1 needs leverage. */
  leverage: number;
  /** Reward-to-risk: target distance over stop distance. */
  rewardRisk: number;
  /** Fees for entry plus the exit at the stop / at the target. */
  feesAtStop: number;
  feesAtTarget: number;
  lossAtStop: number;
  gainAtTarget: number;
  /** Win rate needed to break even after fees. */
  breakEven: number;
}

export type RiskResult = { ok: true; position: Position } | { ok: false; error: string };

export function computePosition(input: RiskInput): RiskResult {
  const { account, riskPct, entry, stop, target, feePct } = input;
  const values = [account, riskPct, entry, stop, target, feePct];
  if (values.some((v) => !Number.isFinite(v))) return { ok: false, error: "Fill in every field." };
  if (account <= 0) return { ok: false, error: "Account size must be above zero." };
  if (riskPct <= 0 || riskPct > 100)
    return { ok: false, error: "Risk per trade must be between 0 and 100%." };
  if (entry <= 0 || stop <= 0 || target <= 0)
    return { ok: false, error: "Prices must be above zero." };
  if (feePct < 0) return { ok: false, error: "Fees can't be negative." };
  if (stop === entry) return { ok: false, error: "The stop can't equal the entry." };

  const direction = stop < entry ? "long" : "short";
  const targetOk = direction === "long" ? target > entry : target < entry;
  if (!targetOk) {
    return {
      ok: false,
      error:
        direction === "long"
          ? "For a long (stop below entry), the target must be above entry."
          : "For a short (stop above entry), the target must be below entry.",
    };
  }

  const riskAmount = (account * riskPct) / 100;
  const stopDistance = Math.abs(entry - stop);
  const quantity = riskAmount / stopDistance;
  const notional = quantity * entry;
  const fee = feePct / 100;
  const feesAtStop = quantity * (entry + stop) * fee;
  const feesAtTarget = quantity * (entry + target) * fee;
  const lossAtStop = riskAmount + feesAtStop;
  const gainAtTarget = quantity * Math.abs(target - entry) - feesAtTarget;
  const breakEven = gainAtTarget > 0 ? lossAtStop / (gainAtTarget + lossAtStop) : 1;

  return {
    ok: true,
    position: {
      direction,
      riskAmount,
      stopDistance,
      stopPct: (stopDistance / entry) * 100,
      quantity,
      notional,
      leverage: notional / account,
      rewardRisk: Math.abs(target - entry) / stopDistance,
      feesAtStop,
      feesAtTarget,
      lossAtStop,
      gainAtTarget,
      breakEven,
    },
  };
}

/** Mean result per trade at win rate `p`, after fees. */
export function expectedValue(position: Position, p: number): number {
  return p * position.gainAtTarget - (1 - p) * position.lossAtStop;
}

// ----------------------------------------------------------------------------
// Remembered defaults (account size, risk %, fee) — a per-browser convenience.
// ----------------------------------------------------------------------------

export const RISK_PREFS_STORAGE_KEY = "risk:prefs";

export interface RiskPrefs {
  account: number;
  riskPct: number;
  feePct: number;
}

export const DEFAULT_RISK_PREFS: RiskPrefs = { account: 10_000, riskPct: 1, feePct: 0.05 };

function inRange(v: unknown, min: number, max: number): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > min && v <= max;
}

/** Validate an unknown parsed value; any bad field falls back to its default. */
export function parseRiskPrefs(value: unknown): RiskPrefs {
  const v = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  return {
    account: inRange(v.account, 0, 1e12) ? v.account : DEFAULT_RISK_PREFS.account,
    riskPct: inRange(v.riskPct, 0, 100) ? v.riskPct : DEFAULT_RISK_PREFS.riskPct,
    feePct:
      typeof v.feePct === "number" && v.feePct >= 0 && v.feePct <= 5
        ? v.feePct
        : DEFAULT_RISK_PREFS.feePct,
  };
}

export function loadRiskPrefs(): RiskPrefs {
  try {
    const raw = localStorage.getItem(RISK_PREFS_STORAGE_KEY);
    return parseRiskPrefs(raw ? JSON.parse(raw) : null);
  } catch {
    return DEFAULT_RISK_PREFS;
  }
}

export function saveRiskPrefs(prefs: RiskPrefs): void {
  try {
    localStorage.setItem(RISK_PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Storage blocked (private mode): defaults are used next time.
  }
}
