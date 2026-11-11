/**
 * Full-depth order books for the chart's liquidity heatmap: Binance USDⓈ-M and OKX
 * perpetuals, each on its own socket (one failing never blocks the other), sampled
 * every `SAMPLE_MS` into price buckets while a chart shows the heatmap.
 *
 * Runs only while subscribed; samples live in this tab (since the page opened).
 */
import { BaseWebSocketClient } from "../websocket/BaseWebSocketClient";
import {
  BinanceBookSync,
  OkxBookSync,
  parseBinanceDiff,
  parseLevels,
  parseOkxBook,
  type LocalBook,
} from "../utils/depthBook";
import {
  bucketForBooks,
  sampleBooks,
  stableBucket,
  type BookSample,
} from "../utils/liquidityHeatmap";

export type DepthExchange = "BINANCE" | "OKX";
export type FeedState = "connecting" | "live" | "down";

export interface LiquiditySnapshot {
  symbol: string | null;
  feeds: Record<DepthExchange, { state: FeedState; levels: number; error: string | null }>;
  samples: readonly BookSample[];
  version: number;
}

export const SAMPLE_MS = 2_000;
const MAX_SAMPLES = 3_600; // two hours at 2 s
const RESYNC_MIN_MS = 5_000;

interface Feed {
  book: () => LocalBook;
  ready: () => boolean;
  close: () => void;
}

type FetchJson = (url: string) => Promise<unknown>;

const defaultFetch: FetchJson = async (url) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

const emptyFeeds = (): LiquiditySnapshot["feeds"] => ({
  BINANCE: { state: "connecting", levels: 0, error: null },
  OKX: { state: "connecting", levels: 0, error: null },
});

export class LiquidityService {
  private static instance: LiquidityService | null = null;
  private listeners = new Set<() => void>();
  private feeds = new Map<DepthExchange, Feed>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private bucket: number | null = null;
  private snap: LiquiditySnapshot = { symbol: null, feeds: emptyFeeds(), samples: [], version: 0 };

  constructor(
    private fetchJson: FetchJson = defaultFetch,
    private socket: (url: string) => BaseWebSocketClient = (url) =>
      new BaseWebSocketClient(url, {
        heartbeat: url.includes("okx")
          ? {
              enabled: true,
              pingPayload: "ping",
              intervalMs: 25_000,
              expectPongPredicate: (m) => m === "pong",
            }
          : undefined,
      }),
  ) {}

  static getInstance(): LiquidityService {
    LiquidityService.instance ??= new LiquidityService();
    return LiquidityService.instance;
  }

  static resetInstance() {
    LiquidityService.instance?.stop();
    LiquidityService.instance = null;
  }

  getSnapshot = (): LiquiditySnapshot => this.snap;

  /** Stream `symbol`'s books while subscribed (switching symbol restarts the history). */
  subscribe(symbol: string, listener: () => void): () => void {
    if (this.snap.symbol !== symbol) this.start(symbol);
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.stop();
    };
  }

  private start(symbol: string) {
    this.stop();
    this.bucket = null;
    this.snap = { symbol, feeds: emptyFeeds(), samples: [], version: this.snap.version + 1 };
    this.feeds.set("BINANCE", this.binance(symbol));
    this.feeds.set("OKX", this.okx(symbol));
    this.timer = setInterval(() => this.sample(), SAMPLE_MS);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const f of this.feeds.values()) f.close();
    this.feeds.clear();
    this.snap = { ...this.snap, symbol: null };
  }

  private sample() {
    const books = [...this.feeds.entries()]
      .filter(([ex, f]) => f.ready() && this.snap.feeds[ex].state === "live")
      .map(([, f]) => f.book());
    this.bucket = stableBucket(this.bucket, bucketForBooks(books));
    const s = sampleBooks(books, Date.now(), this.bucket ?? undefined);
    const feeds = { ...this.snap.feeds };
    for (const [ex, f] of this.feeds) {
      const b = f.book();
      feeds[ex] = { ...feeds[ex], levels: b.bids.size + b.asks.size };
    }
    const samples = s ? [...this.snap.samples, s].slice(-MAX_SAMPLES) : this.snap.samples;
    this.publish({ samples, feeds });
  }

  private setFeed(ex: DepthExchange, state: FeedState, error: string | null = null) {
    this.publish({ feeds: { ...this.snap.feeds, [ex]: { ...this.snap.feeds[ex], state, error } } });
  }

  private publish(patch: Partial<LiquiditySnapshot>) {
    this.snap = { ...this.snap, ...patch, version: this.snap.version + 1 };
    for (const l of this.listeners) l();
  }

  private binance(symbol: string): Feed {
    const sym = symbol.replace("-", "");
    const sync = new BinanceBookSync();
    const ws = this.socket(
      `wss://fstream.binance.com/stream?streams=${sym.toLowerCase()}@depth@500ms`,
    );
    let lastSnapshot = 0;
    let closed = false;
    const resnapshot = async () => {
      if (closed || Date.now() - lastSnapshot < RESYNC_MIN_MS) return;
      lastSnapshot = Date.now();
      sync.reset();
      try {
        const body = (await this.fetchJson(
          `https://fapi.binance.com/fapi/v1/depth?symbol=${sym}&limit=1000`,
        )) as { lastUpdateId?: unknown; bids?: unknown; asks?: unknown };
        const r = sync.snapshot(
          Number(body.lastUpdateId),
          parseLevels(body.bids),
          parseLevels(body.asks),
        );
        if (r === "resync") void resnapshot();
        else this.setFeed("BINANCE", "live");
      } catch (err) {
        this.setFeed("BINANCE", "down", err instanceof Error ? err.message : String(err));
      }
    };
    // The stream URL carries the subscription, so every reconnect re-subscribes.
    ws.on("open", () => {
      lastSnapshot = 0;
      void resnapshot();
    });
    ws.on("message", (m) => {
      const d = parseBinanceDiff(m);
      if (d && sync.diff(d) === "resync") void resnapshot();
    });
    ws.on("close", () => this.setFeed("BINANCE", "connecting"));
    ws.on("error", () => this.setFeed("BINANCE", "down", "stream error"));
    void ws.connect().catch(() => this.setFeed("BINANCE", "down", "unreachable"));
    return {
      book: () => sync.book,
      ready: () => sync.ready,
      close: () => {
        closed = true;
        ws.close();
      },
    };
  }

  private okx(symbol: string): Feed {
    const instId = `${symbol}-SWAP`;
    const sync = new OkxBookSync();
    let ctVal = 0;
    let closed = false;
    const ws = this.socket("wss://ws.okx.com:8443/ws/v5/public");
    const sub = (op: "subscribe" | "unsubscribe") =>
      ws.send({ op, args: [{ channel: "books", instId }] });
    const contract = this.fetchJson(
      `https://www.okx.com/api/v5/public/instruments?instType=SWAP&instId=${instId}`,
    ).then((body) => {
      const d = (body as { data?: { ctVal?: string }[] }).data?.[0];
      ctVal = Number(d?.ctVal);
      if (!(ctVal > 0)) throw new Error(`${instId} not listed on OKX`);
    });
    contract.catch((err: unknown) =>
      this.setFeed("OKX", "down", err instanceof Error ? err.message : String(err)),
    );
    ws.on("open", () => {
      sync.reset();
      void contract.then(() => !closed && sub("subscribe"));
    });
    ws.on("message", (m) => {
      if (!(ctVal > 0)) return;
      const msg = parseOkxBook(m, ctVal);
      if (!msg) return;
      const r = sync.handle(msg);
      if (r === "resync") {
        sync.reset();
        sub("unsubscribe");
        sub("subscribe");
      } else if (r === "applied" && this.snap.feeds.OKX.state !== "live")
        this.setFeed("OKX", "live");
    });
    ws.on("close", () => this.setFeed("OKX", "connecting"));
    ws.on("error", () => this.setFeed("OKX", "down", "stream error"));
    void ws.connect().catch(() => this.setFeed("OKX", "down", "unreachable"));
    return {
      book: () => sync.book,
      ready: () => sync.ready,
      close: () => {
        closed = true;
        ws.close();
      },
    };
  }
}
