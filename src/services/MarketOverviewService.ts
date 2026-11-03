import { RESEARCH_UNIVERSE } from "./HistoryService";
import { BaseWebSocketClient } from "../websocket/BaseWebSocketClient";
import {
  parseBtcDominance,
  parseFearGreed,
  parseForceOrder,
  parseFuturesTickers,
  parseLongShortRatio,
  parseOpenInterestChange,
  parsePremiumIndex,
  toWire,
  type FearGreed,
  type FuturesTicker,
  type Liquidation,
} from "../utils/marketOverview";

export type SourceState = "loading" | "ok" | "unavailable";

export interface Source<T> {
  state: SourceState;
  value: T;
  /** Epoch ms of the last successful read. */
  updatedAt: number | null;
}

export interface MarketOverview {
  symbols: readonly string[];
  tickers: Source<FuturesTicker[]>;
  funding: Source<Map<string, { fundingPct: number; nextFundingTime: number }>>;
  /** Open-interest change over the last 24 hours, % per symbol. */
  openInterest: Source<Map<string, number>>;
  /** Binance global long/short account ratio per symbol (1h). */
  longShort: Source<Map<string, number>>;
  fearGreed: Source<FearGreed | null>;
  btcDominance: Source<number | null>;
  liquidations: {
    state: "connecting" | "live" | "down";
    /** Since when the stream has been collecting (page open), epoch ms. */
    since: number;
    list: Liquidation[];
  };
}

type Fetcher = (url: string) => Promise<unknown>;

const FAPI = "https://fapi.binance.com";
const EVERY = {
  tickers: 30_000,
  derivatives: 5 * 60_000,
  fearGreed: 30 * 60_000,
  dominance: 10 * 60_000,
};
const LIQ_WINDOW_MS = 24 * 3_600_000;
const LIQ_MAX = 5_000;

const defaultFetcher: Fetcher = async (url) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

function source<T>(value: T): Source<T> {
  return { state: "loading", value, updatedAt: null };
}

/**
 * Market overview for the Dashboard: free, keyless sources polled while someone is
 * subscribed, plus Binance's liquidation stream. Each source fails on its own and
 * is shown as unavailable rather than blocking the rest.
 */
export class MarketOverviewService {
  private static instance: MarketOverviewService | null = null;
  private listeners = new Set<() => void>();
  private timers: ReturnType<typeof setInterval>[] = [];
  private ws: BaseWebSocketClient | null = null;
  private snap: MarketOverview;

  constructor(
    private symbols: readonly string[] = RESEARCH_UNIVERSE,
    private fetcher: Fetcher = defaultFetcher,
    private now: () => number = Date.now,
    private openStream = true,
  ) {
    this.snap = {
      symbols,
      tickers: source([]),
      funding: source(new Map()),
      openInterest: source(new Map()),
      longShort: source(new Map()),
      fearGreed: source(null),
      btcDominance: source(null),
      liquidations: { state: "connecting", since: now(), list: [] },
    };
  }

  static getInstance(): MarketOverviewService {
    if (!MarketOverviewService.instance)
      MarketOverviewService.instance = new MarketOverviewService();
    return MarketOverviewService.instance;
  }

  static resetInstance() {
    MarketOverviewService.instance?.stop();
    MarketOverviewService.instance = null;
  }

  getSnapshot = (): MarketOverview => this.snap;

  /** Polling runs only while at least one subscriber is attached. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    if (this.listeners.size === 1) this.start();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.stop();
    };
  }

  private start() {
    const every = (ms: number, fn: () => Promise<void>) => {
      void fn();
      this.timers.push(setInterval(() => void fn(), ms));
    };
    every(EVERY.tickers, () => this.refreshTickers());
    every(EVERY.derivatives, () => this.refreshDerivatives());
    every(EVERY.fearGreed, () => this.refreshFearGreed());
    every(EVERY.dominance, () => this.refreshDominance());
    if (this.openStream) this.connectLiquidations();
  }

  private stop() {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    this.ws?.close();
    this.ws = null;
  }

  async refreshTickers(): Promise<void> {
    await Promise.all([
      this.load("tickers", `${FAPI}/fapi/v1/ticker/24hr`, (raw) => {
        const t = parseFuturesTickers(raw, this.symbols);
        return t.length > 0 ? t : null;
      }),
      this.load("funding", `${FAPI}/fapi/v1/premiumIndex`, (raw) => {
        const m = parsePremiumIndex(raw, this.symbols);
        return m.size > 0 ? m : null;
      }),
    ]);
  }

  async refreshDerivatives(): Promise<void> {
    const per = async (
      path: (wire: string) => string,
      parse: (raw: unknown) => number | null,
    ): Promise<Map<string, number>> => {
      const out = new Map<string, number>();
      await Promise.all(
        this.symbols.map(async (s) => {
          try {
            const v = parse(await this.fetcher(`${FAPI}${path(toWire(s))}`));
            if (v !== null) out.set(s, v);
          } catch {
            // one coin failing leaves the others
          }
        }),
      );
      return out;
    };
    const [oi, ls] = await Promise.all([
      per(
        (w) => `/futures/data/openInterestHist?symbol=${w}&period=1h&limit=25`,
        parseOpenInterestChange,
      ),
      per(
        (w) => `/futures/data/globalLongShortAccountRatio?symbol=${w}&period=1h&limit=1`,
        parseLongShortRatio,
      ),
    ]);
    this.set("openInterest", oi.size > 0 ? oi : null);
    this.set("longShort", ls.size > 0 ? ls : null);
  }

  async refreshFearGreed(): Promise<void> {
    await this.load("fearGreed", "https://api.alternative.me/fng/?limit=8", parseFearGreed);
  }

  async refreshDominance(): Promise<void> {
    await this.load("btcDominance", "https://api.coingecko.com/api/v3/global", parseBtcDominance);
  }

  /** Feed one raw liquidation message (exposed for tests and the stream). */
  addLiquidationMessage(raw: unknown) {
    const l = parseForceOrder(raw);
    const cutoff = this.now() - LIQ_WINDOW_MS;
    if (!l || l.time < cutoff) return;
    const list = [l, ...this.snap.liquidations.list.filter((x) => x.time >= cutoff)].slice(
      0,
      LIQ_MAX,
    );
    this.update({ liquidations: { ...this.snap.liquidations, list } });
  }

  private connectLiquidations() {
    const ws = new BaseWebSocketClient("wss://fstream.binance.com/ws/!forceOrder@arr", {
      autoReconnect: true,
    });
    this.ws = ws;
    const setState = (state: MarketOverview["liquidations"]["state"]) =>
      this.update({ liquidations: { ...this.snap.liquidations, state } });
    ws.on("open", () => setState("live"));
    ws.on("close", () => setState(ws.failedReconnects >= 3 ? "down" : "connecting"));
    ws.on("message", (msg) => this.addLiquidationMessage(msg));
    ws.connect().catch(() => setState("down"));
  }

  private async load<K extends SourceKey>(
    key: K,
    url: string,
    parse: (raw: unknown) => MarketOverview[K]["value"] | null,
  ) {
    try {
      this.set(key, parse(await this.fetcher(url)));
    } catch {
      this.set(key, null);
    }
  }

  private set<K extends SourceKey>(key: K, value: MarketOverview[K]["value"] | null) {
    const prev = this.snap[key];
    const next =
      value === null
        ? { ...prev, state: "unavailable" as const }
        : { state: "ok" as const, value, updatedAt: this.now() };
    this.update({ [key]: next } as Partial<MarketOverview>);
  }

  private update(patch: Partial<MarketOverview>) {
    this.snap = { ...this.snap, ...patch };
    for (const l of this.listeners) l();
  }
}

type SourceKey =
  | "tickers"
  | "funding"
  | "openInterest"
  | "longShort"
  | "fearGreed"
  | "btcDominance";
