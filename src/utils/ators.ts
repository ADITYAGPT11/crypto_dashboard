/**
 * Combined technical indicators and utilities (Module 4).
 *
 * This module re-exports all indicator functions from indicators.ts for
 * compatibility with existing imports in the project.
 *
 * Rationale (OPEN_SOURCE_REUSE.md): bennycode/trading-signals has no LICENSE
 * detected, so the math is implemented in-project as pure, unit-tested functions.
 */

import type { CandleLike as _CandleLike } from "./indicators";
import { sma, ema, rsi, macd, vwap, bollingerBands, atr } from "./indicators";

export { sma, ema, rsi, macd, vwap, bollingerBands, atr };

export type CandleLike = _CandleLike;

export interface MacdPoint {
  macd: number;
  signal: number;
  histogram: number;
}

export interface BollingerPoint {
  upper: number;
  middle: number;
  lower: number;
}
