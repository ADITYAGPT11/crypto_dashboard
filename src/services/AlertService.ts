import EventEmitter from "eventemitter3";
import type { AlertRule, AlertTrigger } from "../types/alertRules";
import { evaluateAlertRules } from "./AlertEngine";
import { alertRulesStorage } from "../utils/alertRulesStorage";
import { LiveMarketDataService } from "./LiveMarketDataService";
import { CandleService } from "./CandleService";
import { OrderBookService } from "./OrderBookService";

export interface AlertServiceContext {
  symbols: string[];
}

export type AlertEventType = "trigger" | "rulesChanged" | "logChanged";

export class AlertService extends EventEmitter<AlertEventType> {
  private static instance: AlertService | null = null;
  private rules: AlertRule[] = [];
  private triggerLog: AlertTrigger[] = [];
  private evaluationTimer: ReturnType<typeof setInterval> | null = null;
  private symbols: string[] = [];
  private engineState: Record<string, number> = {};

  private constructor() {
    super();
  }

  static getInstance(): AlertService {
    if (!AlertService.instance) {
      AlertService.instance = new AlertService();
    }
    return AlertService.instance;
  }

  static resetInstance(): void {
    if (AlertService.instance) {
      AlertService.instance.destroy();
    }
    AlertService.instance = null;
  }

  private destroy(): void {
    if (this.evaluationTimer) {
      clearInterval(this.evaluationTimer);
      this.evaluationTimer = null;
    }
    this.rules = [];
    this.triggerLog = [];
    this.symbols = [];
    this.engineState = {};
    this.removeAllListeners();
  }

  loadRules(): void {
    this.rules = alertRulesStorage.loadRules();
    this.emit("rulesChanged");
  }

  saveRules(): void {
    alertRulesStorage.saveRules(this.rules);
    this.emit("rulesChanged");
  }

  getRules(): AlertRule[] {
    return this.rules;
  }

  addRule(rule: AlertRule): void {
    this.rules.push(rule);
    this.saveRules();
  }

  removeRule(id: string): void {
    this.rules = this.rules.filter((r) => r.id !== id);
    this.saveRules();
  }

  toggleRule(id: string): void {
    const rule = this.rules.find((r) => r.id === id);
    if (rule) {
      rule.enabled = !rule.enabled;
      this.saveRules();
    }
  }

  getTriggerLog(): AlertTrigger[] {
    return this.triggerLog;
  }

  private appendTrigger(trigger: AlertTrigger): void {
    this.triggerLog.push(trigger);
    if (this.triggerLog.length > 100) {
      this.triggerLog = this.triggerLog.slice(-100);
    }
    alertRulesStorage.saveTriggerLog([trigger], this.triggerLog);
    this.emit("logChanged");
    this.emit("trigger", trigger);
  }

  setSymbols(symbols: string[]): void {
    this.symbols = symbols;
  }

  start(): void {
    if (this.evaluationTimer) return;
    this.evaluationTimer = setInterval(() => {
      this.evaluate();
    }, 2000);
  }

  stop(): void {
    if (this.evaluationTimer) {
      clearInterval(this.evaluationTimer);
      this.evaluationTimer = null;
    }
  }

  private evaluate(): void {
    if (this.rules.length === 0 || this.symbols.length === 0) return;

    const liveService = LiveMarketDataService.getInstance();
    const candleService = CandleService.getInstance();
    const bookService = OrderBookService.getInstance();

    // Build prices map
    const prices = new Map<string, { prev: number | null; current: number | null }>();
    const candles = new Map<string, unknown[]>();
    const books = new Map<string, unknown>();

    for (const symbol of this.symbols) {
      for (const exchange of ["BINANCE", "OKX", "DELTA"] as const) {
        for (const type of ["SPOT", "FUT"] as const) {
          const key = `${exchange}|${type}|${symbol}`;

          // Prices with prev/current for cross detection
          const current = liveService.getPrice(exchange, symbol, type);
          const prev = null; // Would need history tracking for proper cross detection
          prices.set(key, { prev, current } as { prev: number | null; current: number | null });

          // Books for imbalance/liquidity conditions
          try {
            const book =
              (
                bookService as unknown as {
                  getBook?: (
                    exchange: ExchangeName,
                    type: MarketType,
                    symbol: string,
                  ) => OrderBookSnapshot | undefined;
                  book?: (
                    exchange: ExchangeName,
                    type: MarketType,
                    symbol: string,
                  ) => OrderBookSnapshot | undefined;
                }
              ).getBook?.(exchange, type, symbol) ??
              (
                bookService as unknown as {
                  book?: (
                    exchange: ExchangeName,
                    type: MarketType,
                    symbol: string,
                  ) => OrderBookSnapshot | undefined;
                }
              ).book?.(exchange, type, symbol);
            if (book) {
              books.set(key, book);
            }
          } catch {
            // book service may not yet support this key
          }
        }
      }
    }

    // Build candles map
    for (const symbol of this.symbols) {
      for (const exchange of ["BINANCE", "OKX"] as const) {
        for (const type of ["SPOT", "FUT"] as const) {
          for (const interval of ["1m", "5m", "15m", "1h", "4h", "1d"] as const) {
            const key = `${exchange}|${type}|${symbol}|${interval}`;
            const candleData = candleService.getCandles(
              exchange as never,
              type as never,
              symbol,
              interval as never,
            );
            if (candleData && candleData.length > 0) {
              candles.set(key, candleData);
            }
          }
        }
      }
    }

    // Evaluate rules
    const ctx = {
      now: Date.now(),
      prices,
      candles: candles as Map<string, import("../types/marketData").Candle[]>,
      books: books as Map<string, import("../types/marketData").OrderBookSnapshot>,
    };

    const { triggers } = evaluateAlertRules(
      this.rules.filter((r) => r.enabled),
      ctx,
      this.engineState,
    );

    this.engineState = { ...this.engineState };

    for (const trigger of triggers) {
      this.appendTrigger(trigger);
    }
  }
}

// Export singleton getter
export const alertService = AlertService.getInstance();
