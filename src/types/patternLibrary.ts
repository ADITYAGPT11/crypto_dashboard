/**
 * Response shapes of the Python backend's pattern endpoints (backend/src/tcs/api/schemas.py).
 * Field names stay snake_case so they can be swapped for openapi-typescript output later.
 */
import type { OutcomeResult, Verdict } from "./analysis";

export type LibraryKind = "chart" | "short" | "candlestick";
export type LibraryDirection = "bullish" | "bearish";

export interface LibraryBracket {
  stop_atr: number;
  target_atr: number;
  max_bars: number;
  break_even: number;
}

export interface LibraryEvent {
  pattern: string;
  label: string;
  kind: LibraryKind;
  direction: LibraryDirection;
  /** Open time (ms) of the candle that completed the pattern. */
  open_time: number;
  entry: number;
  stop: number;
  target: number;
  atr: number;
  outcome: {
    result: OutcomeResult;
    exit_time: number | null;
    bars: number;
    r: number;
    move_pct: number;
  };
}

export interface LibraryPatterns {
  symbol: string;
  interval: string;
  candles: number;
  last_open_time: number | null;
  bracket: LibraryBracket;
  current: LibraryEvent[];
  events: LibraryEvent[];
}

export interface LibraryForward {
  horizon: number;
  n: number;
  mean_pct: number;
  median_pct: number;
  positive_rate: number;
}

export interface LibraryStats {
  n: number;
  wins: number;
  losses: number;
  expired: number;
  open: number;
  win_rate: number;
  ci_low: number;
  ci_high: number;
  ci_low_adjusted: number;
  tests: number;
  break_even: number;
  avg_win_pct: number;
  avg_loss_pct: number;
  expectancy_r: number;
  median_bars: number;
  verdict: Verdict;
  forward: LibraryForward[];
}

export interface LibraryPatternStats {
  pattern: string;
  label: string;
  kind: LibraryKind;
  direction: LibraryDirection;
  own: LibraryStats;
  pooled: LibraryStats;
  recent: LibraryEvent[];
}

export interface LibraryStatsResponse {
  symbol: string;
  interval: string;
  bracket: LibraryBracket;
  symbols: string[];
  unavailable: string[];
  stats: LibraryPatternStats[];
}
