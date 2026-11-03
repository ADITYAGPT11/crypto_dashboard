import type { Candle, CandleInterval } from "../types/marketData";
import type { SetupOccurrence, SetupStats } from "../types/analysis";
import { analyzeSymbol, summarizeAll } from "../utils/setupAnalysis";
import { TF_MS } from "../utils/timeframeMapping";
import { HistoryService, nextClose } from "./HistoryService";

/** A measurement context: patterns on `patternTf`, zones from `zoneTf`. */
export interface StatsContext {
  patternTf: CandleInterval;
  zoneTf: CandleInterval;
}

export const contextKey = (c: StatsContext) => `${c.patternTf}|${c.zoneTf}`;

export interface ContextStats {
  state: "queued" | "running" | "done";
  /** Coins analysed so far out of the universe. */
  done: number;
  total: number;
  failed: string[];
  pooled: Map<string, SetupStats>;
  computedAt: number | null;
}

type Loader = (symbol: string, tf: CandleInterval) => Promise<Candle[]>;

const defaultLoader: Loader = async (symbol, tf) =>
  (await HistoryService.getInstance().load(symbol, tf)).candles;

const yieldToUi = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * Pooled setup statistics for any (pattern timeframe, zone timeframe) context,
 * computed in the background one coin at a time so the page stays responsive.
 * The chart asks for the context it shows first (priority); other timeframes
 * are queued behind it and filled in when there is time.
 */
export class SetupStatsService {
  private static instance: SetupStatsService | null = null;
  private stats = new Map<string, ContextStats>();
  private queue: StatsContext[] = [];
  private running = false;
  private listeners = new Set<() => void>();
  private version = 0;

  constructor(
    private universe: () => string[],
    private loader: Loader = defaultLoader,
    private now: () => number = Date.now,
  ) {}

  static getInstance(universe?: () => string[]): SetupStatsService {
    if (!SetupStatsService.instance) {
      if (!universe) throw new Error("SetupStatsService needs a universe on first use");
      SetupStatsService.instance = new SetupStatsService(universe);
    }
    return SetupStatsService.instance;
  }

  static resetInstance() {
    SetupStatsService.instance = null;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Changes whenever any context's stats change (for useSyncExternalStore). */
  getVersion = () => this.version;

  get(ctx: StatsContext): ContextStats | null {
    return this.stats.get(contextKey(ctx)) ?? null;
  }

  /**
   * Ask for a context. Priority requests jump the queue; the rest wait. A
   * finished context is recomputed once a newer pattern candle has closed.
   */
  request(ctx: StatsContext, priority = false) {
    const key = contextKey(ctx);
    const cur = this.stats.get(key);
    const stale =
      cur?.state === "done" &&
      cur.computedAt !== null &&
      nextClose(cur.computedAt, ctx.patternTf) <= this.now();
    const queuedAt = this.queue.findIndex((q) => contextKey(q) === key);
    if (cur && !stale && (cur.state !== "queued" || !priority || queuedAt <= 0)) return;
    if (queuedAt >= 0) this.queue.splice(queuedAt, 1);
    if (!cur || stale) this.set(key, this.empty(cur));
    if (priority) this.queue.unshift(ctx);
    else this.queue.push(ctx);
    void this.run();
  }

  /** Resolves when the queue is empty (tests). */
  async idle(): Promise<void> {
    while (this.running || this.queue.length) await new Promise((r) => setTimeout(r, 1));
  }

  private empty(prev?: ContextStats): ContextStats {
    return {
      state: "queued",
      done: 0,
      total: this.universe().length,
      failed: [],
      pooled: prev?.pooled ?? new Map(),
      computedAt: prev?.computedAt ?? null,
    };
  }

  private async run() {
    if (this.running) return;
    this.running = true;
    // Let requests made in the same tick queue up first, so priority holds.
    await yieldToUi();
    try {
      while (this.queue.length) {
        const ctx = this.queue.shift()!;
        await this.compute(ctx);
      }
    } finally {
      this.running = false;
    }
  }

  private async compute(ctx: StatsContext) {
    const key = contextKey(ctx);
    const symbols = this.universe();
    const all: SetupOccurrence[] = [];
    const failed: string[] = [];
    this.set(key, { ...this.stats.get(key)!, state: "running", total: symbols.length, done: 0 });
    for (const [n, symbol] of symbols.entries()) {
      try {
        const candles = await this.loader(symbol, ctx.patternTf);
        const zoneCandles =
          ctx.zoneTf === ctx.patternTf ? candles : await this.loader(symbol, ctx.zoneTf);
        if (candles.length > 0 && zoneCandles.length > 0) {
          const a = analyzeSymbol(
            symbol,
            candles,
            ctx.zoneTf === ctx.patternTf
              ? undefined
              : {
                  candles: zoneCandles,
                  patternMs: TF_MS[ctx.patternTf],
                  zoneMs: TF_MS[ctx.zoneTf],
                },
          );
          all.push(...a.occurrences);
        } else failed.push(symbol);
      } catch {
        failed.push(symbol);
      }
      const last = n === symbols.length - 1;
      this.set(key, {
        state: last ? "done" : "running",
        done: n + 1,
        total: symbols.length,
        failed: [...failed],
        pooled: summarizeAll(all),
        computedAt: last ? this.now() : (this.stats.get(key)?.computedAt ?? null),
      });
      await yieldToUi();
    }
  }

  private set(key: string, value: ContextStats) {
    this.stats.set(key, value);
    this.version++;
    for (const l of this.listeners) l();
  }
}
