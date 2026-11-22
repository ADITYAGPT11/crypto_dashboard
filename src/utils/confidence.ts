/**
 * The confidence shown on a pattern: the measured win rate of past setups of the same pattern,
 * direction, timeframe and confidence score (`backend/src/tcs/analysis/confidence.py`), with its
 * uncertainty. Formatting only: the number comes from the analysis service.
 */
import type { ConfidenceOut } from "../api/schema";

export interface ConfidenceLabel {
  /** "41%" */
  value: string;
  /** "±7": half the Wilson 95% range, in percentage points. */
  spread: string;
}

export function confidenceLabel(c: ConfidenceOut | null | undefined): ConfidenceLabel | null {
  if (!c || !Number.isFinite(c.winRate)) return null;
  const half = Math.max(c.winRate - c.ciLow, c.ciHigh - c.winRate);
  return {
    value: `${Math.round(c.winRate * 100)}%`,
    spread: `±${Math.max(1, Math.round(half * 100))}`,
  };
}
