/**
 * Typed alert-rule format (Module 6).
 *
 * Rules are plain serializable data — saved to localStorage today, SQLite
 * later — and evaluated by a pure engine that is independent of the UI. The
 * format is deliberately narrow: every condition kind maps to an observable
 * from our normalized feeds (candles, last prices, visible order book).
 *
 * Determinism promise: `evaluateAlertRules(rules, ctx, state)` produces the
 * same triggers for the same (rules, ctx, state) triple, so recorded fixtures
 * can be replayed against rule changes (Module 8).
 */
import type { Candle, CandleInterval, ExchangeName, MarketType } from "./marketData";
import type { OrderBookSnapshot } from "./marketData";

/** How a rule's conditions combine. */
export type AlertCombine = "ALL" | "ANY";

/**
 * Candle evaluation mode:
 * - "candle_close": only closed candles feed computed conditions (percent
 *   move, volume spike, indicator); fires at most once per closed candle.
 * - "intrabar": live (possibly open) candles are included; triggers can fire
 *   mid-candle and are then governed by the rule's cooldown.
 */
export type AlertEvaluation = "candle_close" | "intrabar";

export type AlertCondition =
  /** Last price crosses a fixed level (fires on the crossing update only). */
  | {
      kind: "priceCross";
      exchange: ExchangeName;
      type: MarketType;
      symbol: string;
      direction: "above" | "below";
      value: number;
    }
  /** Close-to-close percent move across `window` bars of `interval`. */
  | {
      kind: "percentMove";
      exchange: ExchangeName;
      type: MarketType;
      symbol: string;
      interval: CandleInterval;
      /** Number of bars back to compare against (>= 1). */
      window: number;
      percent: number;
      direction: "up" | "down" | "any";
    }
  /** Last bar's volume ≥ multiplier × mean volume of the previous bars. */
  | {
      kind: "volumeSpike";
      exchange: ExchangeName;
      type: MarketType;
      symbol: string;
      interval: CandleInterval;
      lookback: number;
      multiplier: number;
    }
  /** Technical indicator value crosses a fixed threshold on a time frame. */
  | {
      kind: "indicatorThreshold";
      exchange: ExchangeName;
      type: MarketType;
      symbol: string;
      interval: CandleInterval;
      indicator: "rsi" | "sma" | "ema";
      period: number;
      operator: "<" | ">" | "<=" | ">=";
      value: number;
    }
  /** Visible order-book imbalance (topN levels) beyond a threshold in [-1,1]. */
  | {
      kind: "bookImbalance";
      exchange: ExchangeName;
      type: MarketType;
      symbol: string;
      topN: number;
      /** e.g. threshold = 0.6, operator ">" → bids dominate by 60%+ */
      operator: ">" | "<";
      threshold: number;
    }
  /** Any single visible resting level with quantity ≥ minQuantity. */
  | {
      kind: "largeLiquidity";
      exchange: ExchangeName;
      type: MarketType;
      symbol: string;
      minQuantity: number;
    };

/** One saved, evaluable alert rule. */
export interface AlertRule {
  id: string;
  name: string;
  enabled: boolean;
  combine: AlertCombine;
  evaluation: AlertEvaluation;
  /**
   * Cooldown AND dedupe in one knob: minimum ms between two triggers of this
   * rule. Prevents repeat/false duplicate triggers while a condition stays met.
   */
  cooldownMs: number;
  conditions: AlertCondition[];
  createdAt: number;
}

/** One fired alert, logged with the exact inputs and reason. */
export interface AlertTrigger {
  ruleId: string;
  ruleName: string;
  /** Epoch ms of the triggering evaluation. */
  firedAt: number;
  /** Observed input values, e.g. { rsi: "27.4", close: "64321.5" }. */
  values: Record<string, string>;
  /** Human-readable exact reason, e.g. "RSI(14) = 27.4 <= 30 …". */
  reason: string;
}

/** Engine state the caller carries between evaluations. */
export interface AlertEngineState {
  /** ruleId → last trigger epoch ms (drives cooldown + dedupe). */
  lastFiredAt: Record<string, number>;
}

/** Everything the pure engine needs for one evaluation pass. */
export interface AlertEngineContext {
  now: number;
  /**
   * Candle buffers keyed like CandleService: "EXCHANGE|TYPE|symbol|interval",
   * ascending. Missing keys simply make candle conditions unmet.
   */
  candles: Map<string, Candle[]>;
  /** Visible books keyed "EXCHANGE|TYPE|symbol". */
  books: Map<string, OrderBookSnapshot>;
  /** Last and current price keyed "EXCHANGE|TYPE|symbol" (priceCross needs prev). */
  prices: Map<string, { prev: number | null; current: number | null }>;
}
