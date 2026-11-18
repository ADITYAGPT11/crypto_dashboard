/**
 * Full-depth order books for the chart's liquidity heatmap, aggregated across the three
 * exchanges we support: Binance USDⓈ-M, OKX and Delta Exchange India perpetuals, each on its
 * own socket (one failing never blocks the others), summed and sampled every `SAMPLE_MS` into
 * price buckets within ±2% of the mid while a chart shows the heatmap. Delta is USD-quoted;
 * its levels are added at face value (USD ≈ USDT, well inside one bucket).
 *
 * Runs only while subscribed; samples live in this tab (since the page opened). Older history
 * comes from the analysis service's recorder (`useDepthHistory`).
 */
import { BaseWebSocketClient } from "../websocket/BaseWebSocketClient";
import {
  BinanceBookSync,
  farBook,
  LocalBook,
  OkxBookSync,
  parseDeltaL2,
  parseOkxFullBook,
  parseBinanceDiff,
  parseLevels,
  parseOkxBook,
} from "../utils/depthBook";
import {
  bucketForBooks,
  midOf,
  sampleBooks,
  stableBucket,
  windowNotional,
  type BookSample,
} from "../utils/liquidityHeatmap";

export type DepthExchange = "BINANCE" | "OKX" | "DELTA";
export const DEPTH_EXCHANGES: readonly DepthExchange[] = ["BINANCE", "OKX", "DELTA"];
export type FeedState = "connecting" | "live" | "down";

export interface LiquiditySnapshot {
  symbol: string | null;
  feeds: Record<
    DepthExchange,
    {
      state: FeedState;
      levels: number;
      error: string | null;
      /** Share of the aggregated resting notional (within the heat window) in the last sample. */
      share: number | null;
    }
  >;
  samples: readonly BookSample[];
  version: number;
}

export const SAMPLE_MS = 2_000;
// One hour at 2 s with ~240 buckets each; older history comes from the analysis service.
const MAX_SAMPLES = 1_800;
const RESYNC_MIN_MS = 5_000;
/** OKX's full book (5 000 levels a side, REST) refreshes the far levels this often. */
const DEEP_MS = 5_000;

interface Feed {
  book: () => LocalBook;
  ready: () => boolean;
  close: () => void;
  /** A deeper, slower book for the levels beyond the live one (OKX only). */
  deep?: () => LocalBook | null;
}

type FetchJson = (url: string) => Promise<unknown>;

const defaultFetch: FetchJson = async (url) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

export const emptyFeeds = (): LiquiditySnapshot["feeds"] => ({
  BINANCE: { state: "connecting", levels: 0, error: null, share: null },
  OKX: { state: "connecting", levels: 0, error: null, share: null },
  DELTA: { state: "connecting", levels: 0, error: null, share: null },
});
/** Delta sends a snapshot every few seconds; none for this long means the feed stalled. */
const DELTA_STALE_MS = 20_000;

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
    this.feeds.set("DELTA", this.delta(symbol));
    this.timer = setInterval(() => this.sample(), SAMPLE_MS);
  }

  /**
   * Use the bucket size the analysis service recorded with, unless the live books' reach is
   * more than 2× different (then history and live could not share a column anyway).
   */
  preferBucket(bucket: number) {
    if (!(bucket > 0)) return;
    if (this.bucket === null || stableBucket(bucket, this.bucket) === bucket) this.bucket = bucket;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const f of this.feeds.values()) f.close();
    this.feeds.clear();
    this.snap = { ...this.snap, symbol: null };
  }

  private sample() {
    const live = [...this.feeds.entries()].filter(
      ([ex, f]) => f.ready() && this.snap.feeds[ex].state === "live",
    );
    // Each exchange's live book, plus (OKX) its deep REST book beyond its own live levels.
    const perExchange = live.map(([ex, f]) => {
      const d = f.deep?.();
      return [ex, d ? [f.book(), farBook(d, [f.book()])] : [f.book()]] as const;
    });
    const books = perExchange.flatMap(([, bs]) => bs);
    this.bucket = stableBucket(this.bucket, bucketForBooks(books));
    const s = sampleBooks(books, Date.now(), this.bucket ?? undefined);
    if (s) s.span = SAMPLE_MS;
    const feeds = { ...this.snap.feeds };
    const mid = midOf(books);
    const totals = new Map<DepthExchange, number>();
    if (mid !== null)
      for (const [ex, bs] of perExchange)
        totals.set(
          ex,
          bs.reduce((sum, b) => sum + windowNotional(b, mid), 0),
        );
    const all = [...totals.values()].reduce((a, b) => a + b, 0);
    for (const [ex, f] of this.feeds) {
      const b = f.book();
      const t = totals.get(ex);
      feeds[ex] = {
        ...feeds[ex],
        levels: b.bids.size + b.asks.size,
        share: t !== undefined && all > 0 ? t / all : null,
      };
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
      `wss://fstream.binance.com/public/stream?streams=${sym.toLowerCase()}@depth@500ms`,
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
    let deep: LocalBook | null = null;
    const pollDeep = async () => {
      if (closed || !(ctVal > 0)) return;
      try {
        const body = await this.fetchJson(
          `https://www.okx.com/api/v5/market/books-full?instId=${instId}&sz=5000`,
        );
        deep = parseOkxFullBook(body, ctVal) ?? deep;
      } catch {
        // Keep the last deep book; the live levels near the price are unaffected.
      }
    };
    const deepTimer = setInterval(() => void pollDeep(), DEEP_MS);
    const ws = this.socket("wss://ws.okx.com/ws/v5/public");
    const sub = (op: "subscribe" | "unsubscribe") =>
      ws.send({ op, args: [{ channel: "books", instId }] });
    const contract = this.fetchJson(
      `https://www.okx.com/api/v5/public/instruments?instType=SWAP&instId=${instId}`,
    ).then((body) => {
      const d = (body as { data?: { ctVal?: string }[] }).data?.[0];
      ctVal = Number(d?.ctVal);
      if (!(ctVal > 0)) throw new Error(`${instId} not listed on OKX`);
      void pollDeep();
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
      deep: () => deep,
      close: () => {
        closed = true;
        clearInterval(deepTimer);
        ws.close();
      },
    };
  }

  /**
   * Delta Exchange India: `l2_orderbook` sends the whole book every few seconds, so each
   * message replaces the book (nothing to sequence). Contract size from the public products API.
   */
  private delta(symbol: string): Feed {
    const product = `${symbol.split("-")[0]}USD`;
    let book = new LocalBook();
    let ready = false;
    let contractValue = 0;
    let lastAt = 0;
    let closed = false;
    const ws = this.socket("wss://socket.india.delta.exchange");
    const contract = this.fetchJson(`https://api.india.delta.exchange/v2/products/${product}`).then(
      (body) => {
        contractValue = Number(
          (body as { result?: { contract_value?: string } }).result?.contract_value,
        );
        if (!(contractValue > 0)) throw new Error(`${product} not listed on Delta`);
      },
    );
    contract.catch((err: unknown) =>
      this.setFeed("DELTA", "down", err instanceof Error ? err.message : String(err)),
    );
    ws.on("open", () => {
      ready = false;
      void contract.then(
        () =>
          !closed &&
          ws.send({
            type: "subscribe",
            payload: { channels: [{ name: "l2_orderbook", symbols: [product] }] },
          }),
      );
    });
    ws.on("message", (m) => {
      if (!(contractValue > 0)) return;
      const next = parseDeltaL2(m, contractValue);
      if (!next) return;
      book = next;
      ready = true;
      lastAt = Date.now();
      if (this.snap.feeds.DELTA.state !== "live") this.setFeed("DELTA", "live");
    });
    ws.on("close", () => this.setFeed("DELTA", "connecting"));
    ws.on("error", () => this.setFeed("DELTA", "down", "stream error"));
    void ws.connect().catch(() => this.setFeed("DELTA", "down", "unreachable"));
    return {
      book: () => book,
      ready: () => {
        if (ready && Date.now() - lastAt > DELTA_STALE_MS) {
          ready = false;
          this.setFeed("DELTA", "connecting", "no snapshot for 20 s");
        }
        return ready;
      },
      close: () => {
        closed = true;
        ws.close();
      },
    };
  }
}
