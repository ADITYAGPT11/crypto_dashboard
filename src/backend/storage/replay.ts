/**
 * Replay Engine (Module 8 - Historical Replay & Alert Testing)
 *
 * Replays recorded market events at configurable speed for:
 * - Testing alert rules against historical data
 * - Demonstrating platform capabilities
 * - Validating rule changes against known outcomes
 */

import type { Candle, TradeEvent, OrderBookSnapshot } from "../../types/marketData";
import { HistoricalDatabase, type StorageConfig } from "./database";
import type {
  AlertRule,
  AlertTrigger,
  AlertEngineContext,
  AlertEngineState,
} from "../../types/alertRules";
import { evaluateAlertRules } from "../../services/AlertEngine";

export interface ReplayConfig {
  speed: number; // 1 = real-time, 10 = 10x speed, 100 = 100x speed
  symbols: string[];
  startDate?: number;
  endDate?: number;
  rules?: AlertRule[];
  onTrigger?: (trigger: AlertTrigger) => void;
  onProgress?: (progress: number) => void;
}

export interface ReplayStats {
  totalCandles: number;
  totalTrades: number;
  totalTriggers: number;
  durationMs: number;
  simulatedDurationMs: number;
}

export class ReplayEngine {
  private db: HistoricalDatabase;
  private config: ReplayConfig;
  private isRunning: boolean = false;
  private cancelRequested: boolean = false;

  constructor(config: ReplayConfig) {
    this.config = config;
    this.db = new HistoricalDatabase({
      dbPath: "./data/history.db",
      maxRetentionDays: 30,
      maxRowsPerTable: 1_000_000,
    } as StorageConfig);
  }

  async start(): Promise<ReplayStats> {
    if (this.isRunning) {
      throw new Error("Replay already in progress");
    }

    this.isRunning = true;
    this.cancelRequested = false;

    const startTime = Date.now();
    let totalTriggers = 0;

    // Get historical data
    const candles = await this.fetchHistoricalCandles();
    const trades = await this.fetchHistoricalTrades();

    const totalTrades = trades.length;

    // Build alert engine context
    const _engineState = { lastFiredAt: {} as Record<string, number> };
    const rules = this.config.rules?.filter((r) => r.enabled) ?? [];

    // Replay loop - process candles in chronological order
    let idx = 0;

    while (idx < candles.length && !this.cancelRequested) {
      const candle = candles[idx];

      // Evaluate rules at this candle
      if (rules.length > 0) {
        const ctx = this.buildContext(candle, candles.slice(0, idx + 1), trades);
        const { triggers } = evaluateAlertRules(rules, ctx, engineState);
        // Keep engineState updated via the engine itself (if it mutates).

        for (const trigger of triggers) {
          totalTriggers++;
          this.config.onTrigger?.(trigger);
        }
      }

      // Progress update
      const progress = (idx / candles.length) * 100;
      this.config.onProgress?.(progress);

      // Wait for next event at configured speed
      await this.sleep(1000 / this.config.speed);

      idx++;
    }

    const endTime = Date.now();
    const durationMs = endTime - startTime;

    // Calculate simulated duration (sum of candle intervals)
    let simulatedDurationMs = 0;
    for (let i = 1; i < candles.length; i++) {
      simulatedDurationMs += candles[i].openTime - candles[i - 1].openTime;
    }

    this.isRunning = false;

    return {
      totalCandles: processedCount(idx, candles.length),
      totalTrades,
      totalTriggers,
      durationMs,
      simulatedDurationMs,
    };
  }

  stop(): void {
    this.cancelRequested = true;
  }

  isRunningCheck(): boolean {
    return this.isRunning;
  }

  private async fetchHistoricalCandles(): Promise<Candle[]> {
    const result: Candle[] = [];

    for (const symbol of this.config.symbols) {
      for (const exchange of ["BINANCE", "OKX"] as const) {
        for (const type of ["SPOT", "FUT"] as const) {
          for (const interval of ["1m", "5m", "15m", "1h", "4h", "1d"] as const) {
            const candles = this.db.getCandles(
              exchange,
              symbol,
              type,
              interval,
              this.config.startDate,
              this.config.endDate,
              10000,
            );
            result.push(...candles);
          }
        }
      }
    }

    // Sort by timestamp
    result.sort((a, b) => a.openTime - b.openTime);

    return result;
  }

  private async fetchHistoricalTrades(): Promise<TradeEvent[]> {
    const result: TradeEvent[] = [];

    for (const symbol of this.config.symbols) {
      for (const exchange of ["BINANCE", "OKX", "DELTA"] as const) {
        for (const type of ["SPOT", "FUT"] as const) {
          const trades = this.db.getTrades(
            exchange,
            symbol,
            type,
            this.config.startDate,
            this.config.endDate,
            10000,
          );
          result.push(...trades);
        }
      }
    }

    // Sort by timestamp
    result.sort((a, b) => a.timeStamp - b.timeStamp);

    return result;
  }

  private buildContext(
    candle: Candle,
    allCandles: Candle[],
    _allTrades: TradeEvent[],
  ): AlertEngineContext {
    // Build prices map from candle closes
    const prices = new Map<string, { prev: number | null; current: number | null }>();

    // Build candles map grouped by key
    const candlesMap = new Map<string, Candle[]>();

    for (const c of allCandles) {
      // Infer key - simplified, real impl would track symbol/exchange/type
      const key = `BINANCE|SPOT|${c.openTime}`; // Placeholder
      if (!candlesMap.has(key)) {
        candlesMap.set(key, []);
      }
      candlesMap.get(key)!.push(c);
    }

    // Build books map from order book snapshots
    const books = new Map<string, OrderBookSnapshot>();

    return {
      now: candle.openTime,
      prices,
      candles: candlesMap as Map<string, Candle[]>,
      books,
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

function processedCount(idx: number, total: number): number {
  return Math.min(idx, total);
}

// -----------------------------------------------------------------------
// Replay Test Helper
// -----------------------------------------------------------------------

export interface ReplayTestResult {
  ruleId: string;
  ruleName: string;
  triggered: boolean;
  triggerCount: number;
  firstTriggerAt?: number;
  triggers: AlertTrigger[];
}

export function testRuleAgainstHistory(
  rule: AlertRule,
  candles: Candle[],
  _trades: TradeEvent[] = [],
): ReplayTestResult {
  const _engineState = { lastFiredAt: {} as Record<string, number> };

  // Build context from candles
  const candlesMap = new Map<string, Candle[]>();
  for (const candle of candles) {
    const key = `BINANCE|SPOT|${candle.openTime}`; // Placeholder key
    if (!candlesMap.has(key)) {
      candlesMap.set(key, []);
    }
    candlesMap.get(key)!.push(candle);
  }

  const ctx: AlertEngineContext = {
    now: candles[candles.length - 1]?.openTime ?? Date.now(),
    prices: new Map(),
    candles: candlesMap,
    books: new Map(),
  };

  const { triggers: newTriggers } = evaluateAlertRules([rule], ctx, { lastFiredAt: {} });

  return {
    ruleId: rule.id,
    ruleName: rule.name,
    triggered: newTriggers.length > 0,
    triggerCount: newTriggers.length,
    firstTriggerAt: newTriggers[0]?.firedAt,
    triggers: newTriggers,
  };
}

export function compareRuleVersions(
  oldRules: AlertRule[],
  newRules: AlertRule[],
  candles: Candle[],
  trades: TradeEvent[] = [],
): {
  oldResults: ReplayTestResult[];
  newResults: ReplayTestResult[];
  differences: string[];
} {
  const oldResults = oldRules.map((rule) => testRuleAgainstHistory(rule, candles, trades));
  const newResults = newRules.map((rule) => testRuleAgainstHistory(rule, candles, trades));

  const differences: string[] = [];

  for (const newResult of newResults) {
    const oldResult = oldResults.find((r) => r.ruleId === newResult.ruleId);
    if (oldResult) {
      if (oldResult.triggered !== newResult.triggered) {
        differences.push(
          `${newResult.ruleName}: ${oldResult.triggered ? "was" : "was not"} firing, now ${newResult.triggered ? "fires" : "does not fire"}`,
        );
      }
      if (oldResult.triggerCount !== newResult.triggerCount) {
        differences.push(
          `${newResult.ruleName}: trigger count changed from ${oldResult.triggerCount} to ${newResult.triggerCount}`,
        );
      }
    }
  }

  return { oldResults, newResults, differences };
}
