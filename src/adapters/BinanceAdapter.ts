import EventEmitter from "eventemitter3";
import { BaseWebSocketClient } from "../websocket/BaseWebSocketClient";
import type {
  CandleData,
  CandleInterval,
  GenericMarketData,
  OrderBookBbo,
  OrderBookLevel,
  OrderBookSnapshot,
  TradeEvent,
} from "../types/marketData";
import { normalizeHistory, toCanonicalInterval, toCandle } from "../utils/candleUtils";
import type { ConnectionStatusPayload } from "../types/connection";

type BinanceMarket = "spot" | "futures";

/** The stream kinds a dashboard consumer can ask for, per symbol. */
export type BinanceStreamKind = "aggTrade" | "bookTicker" | "depth";

/** Raw partial-book payload (top-N full arrays; delivered repeatedly). */
interface BinancePartialDepth {
  lastUpdateId: number;
  bids: Array<[string, string]>;
  asks: Array<[string, string]>;
}

/** bookTicker payload: best bid/ask price + qty. */
interface BinanceBookTickerMsg {
  s: string;
  b: string; // best bid price
  B: string; // best bid qty
  a: string; // best ask price
  A: string; // best ask qty
  E?: number; // event time (ms)
}

/** flag-type message for the next funding event emitted below. */
interface FundingRateEvent {
  exchange: "BINANCE";
  symbol: string;
  fundingRate: number;
  nextFundingTime: number;
}

/** Combined-stream envelope: stream raw market payloads are wrapped like this. */
interface CombinedStreamMsg {
  stream?: string; // e.g. "btcusdt@kline_1m"
  data?: unknown; // exchange payload for that stream
  result?: null; // SUBSCRIBE/UNSUBSCRIBE result acks
  id?: number;
}

//** Canonical symbol → wire symbol for a stream name, e.g. BTC-USDT → "btcusdt". */
function toWireSymbol(symbol: string): string {
  return symbol.replace("-", "").toLowerCase();
}

/** Wire symbol back to canonical: "BTCUSDT" → "BTC-USDT" (also catches lowercase forms). */
function fromWireSymbol(raw: string): string | null {
  const up = raw.toUpperCase();
  if (!up.endsWith("USDT") || up.length <= 4) return null;
  return `${up.slice(0, -4)}-USDT`;
}

export class BinanceAdapter extends EventEmitter {
  private clients: Record<BinanceMarket, BaseWebSocketClient>;
  // Stream params per market (e.g. "btcusdt@aggTrade") — used to (re)subscribe on every open.
  private trackedStreams: Record<BinanceMarket, Set<string>> = {
    spot: new Set(),
    futures: new Set(),
  };
  private lastEmittedRate = new Map<string, string>(); // symbol → skip duplicate funding events

  private readonly urls: Record<BinanceMarket, string> = {
    spot: "wss://stream.binance.com:9443/stream",
    futures: "wss://fstream.binance.com/stream",
  };

  constructor() {
    super();
    this.clients = {
      spot: new BaseWebSocketClient(this.urls.spot, { autoReconnect: true }),
      futures: new BaseWebSocketClient(this.urls.futures, { autoReconnect: true }),
    };
    this.setupClient("spot");
    this.setupClient("futures");
  }

  private setupClient(market: BinanceMarket) {
    const ws = this.clients[market];

    ws.on("message", (rawMsg) => {
      const envelope = rawMsg as CombinedStreamMsg;
      // SUBSCRIBE/UNSUBSCRIBE acks have no `stream`; ignore them.
      if (envelope.result !== undefined || !envelope.stream) return;
      this.routeStream(market, envelope.stream, envelope.data);
    });

    ws.on("open", () => {
      this.sendAllSubscriptions(market);
      this.emit("connectionStatus", {
        exchange: "BINANCE",
        market,
        state: "live",
      } satisfies ConnectionStatusPayload);
    });

    ws.on("close", () => {
      // autoReconnect will retry; report as reconnecting
      this.emit("connectionStatus", {
        exchange: "BINANCE",
        market,
        state: "connecting",
      } satisfies ConnectionStatusPayload);
    });

    ws.on("error", (error) => {
      console.error(`Binance ${market} WebSocket error:`, error);
    });
  }

  async connect(): Promise<void> {
    // Spot and futures connect in parallel; an isolated failure in one market
    // (unusual) shouldn't block the other.
    await Promise.all([this.clients.spot.connect(), this.clients.futures.connect()]);
  }

  /** Subscribe both markets to the same set of per-symbol streams ( trays of streams per symbol). */
  subscribe(symbols: string | string[], streams: BinanceStreamKind[]) {
    const arr = Array.isArray(symbols) ? symbols : [symbols];
    for (const market of ["spot", "futures"] as BinanceMarket[]) {
      const fresh: string[] = [];
      for (const symbol of arr) {
        for (const kind of streams) {
          const raw = `${toWireSymbol(symbol)}@${BINANCE_STREAM_TAIL[kind]}`;
          if (!this.trackedStreams[market].has(raw)) {
            this.trackedStreams[market].add(raw);
            fresh.push(raw);
          }
        }
      }
      if (fresh.length > 0) {
        this.clients[market].send({ method: "SUBSCRIBE", params: fresh, id: nextRequestId() });
      }
    }
  }

  /** Wrapped funding-rate stream for futures (markPrice, 1s cadence). */
  subscribeFundingRate(symbols: string | string[]) {
    const arr = Array.isArray(symbols) ? symbols : [symbols];
    const fresh = arr
      .map((s) => `${toWireSymbol(s)}@markPrice@1s`)
      .filter((raw) => {
        if (this.trackedStreams.futures.has(raw)) return false;
        this.trackedStreams.futures.add(raw);
        return true;
      });
    if (fresh.length > 0) {
      this.clients.futures.send({ method: "SUBSCRIBE", params: fresh, id: nextRequestId() });
    }
  }

  private sendAllSubscriptions(market: BinanceMarket) {
    const streams = Array.from(this.trackedStreams[market]);
    if (streams.length === 0) return;
    this.clients[market].send({ method: "SUBSCRIBE", params: streams, id: nextRequestId() });
  }

  // ------------------------------------------------------------------
  // Candles (Module 4) — WS kline streams + REST history backfill
  // ------------------------------------------------------------------

  subscribeCandles(symbol: string, interval: CandleInterval, market: BinanceMarket) {
    const raw = `${toWireSymbol(symbol)}@kline_${interval}`;
    if (this.trackedStreams[market].has(raw)) return;
    this.trackedStreams[market].add(raw);
    this.clients[market].send({ method: "SUBSCRIBE", params: [raw], id: nextRequestId() });
  }

  unsubscribeCandles(symbol: string, interval: CandleInterval, market: BinanceMarket) {
    const raw = `${toWireSymbol(symbol)}@kline_${interval}`;
    if (!this.trackedStreams[market].delete(raw)) return;
    this.clients[market].send({ method: "UNSUBSCRIBE", params: [raw], id: nextRequestId() });
  }

  /**
   * REST history backfill (returned ascending). No key, no signing.
   * `limit` caps rows per page (Binance allows up to 1000 spot / 1500 futures);
   * pass `endTime` (epoch ms) to page further back through history.
   */
  async fetchCandleHistory(
    symbol: string,
    interval: CandleInterval,
    market: BinanceMarket,
    limit = 1000,
    endTime?: number,
  ): Promise<CandleData[]> {
    const restBase =
      market === "spot" ? "api.binance.com/api/v3/klines" : "fapi.binance.com/fapi/v1/klines";
    const url = `https://${restBase}?symbol=${toWireSymbol(symbol).toUpperCase()}&interval=${interval}&limit=${limit}${
      endTime != null ? `&endTime=${endTime}` : ""
    }`;
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) {
      throw new Error(`Binance candles HTTP ${response.status}`);
    }
    const payload = (await response.json()) as Array<
      [number, string, string, string, string, string]
    >;
    const candles = normalizeHistory(
      (payload ?? []).map((row) => ({
        openTime: row[0],
        open: parseFloat(row[1]),
        high: parseFloat(row[2]),
        low: parseFloat(row[3]),
        close: parseFloat(row[4]),
        volume: parseFloat(row[5]),
      })),
    );
    return candles.map((candle) => ({
      exchange: "BINANCE" as const,
      type: market === "spot" ? ("SPOT" as const) : ("FUT" as const),
      symbol,
      interval,
      candle,
    }));
  }

  // ------------------------------------------------------------------
  // Stream routing — everything below emits normalized events via emit()
  // ------------------------------------------------------------------

  private routeStream(market: BinanceMarket, stream: string, data: unknown) {
    const marketType = market === "spot" ? "SPOT" : "FUT";

    const [symRaw, ...kindParts] = stream.split("@");
    const kind = kindParts.join("@");
    const symbol = fromWireSymbol(symRaw ?? "");
    if (!symbol || !kind) return;

    if (kind === "aggTrade") {
      const t = data as { p?: string; q?: string; m?: boolean; T?: number; E?: number } | undefined;
      const price = parseFloat(t?.p ?? "0");
      this.emit("marketData", {
        exchange: "BINANCE",
        symbol,
        type: marketType,
        currentPrice: price,
        timeStamp: t?.T ?? t?.E ?? Date.now(),
      } satisfies GenericMarketData);

      // Module 5 trade print (aggTrade merges fills; m = buyer was the maker).
      const quantity = parseFloat(t?.q ?? "0");
      if (price > 0 && quantity > 0 && t?.T != null) {
        this.emit("trade", {
          exchange: "BINANCE",
          symbol,
          type: marketType,
          price,
          quantity,
          buyerMaker: t.m === true,
          timeStamp: t.T,
        } satisfies TradeEvent);
      }
      return;
    }

    if (kind === "bookTicker") {
      const ticker = data as BinanceBookTickerMsg | undefined;
      if (!ticker) return;
      this.emit("orderBookBbo", {
        exchange: "BINANCE",
        type: marketType,
        symbol,
        bidPrice: parseFloat(ticker.b ?? "0"),
        bidQuantity: parseFloat(ticker.B ?? "0"),
        askPrice: parseFloat(ticker.a ?? "0"),
        askQuantity: parseFloat(ticker.A ?? "0"),
        timeStamp: ticker.E ?? Date.now(),
      } satisfies OrderBookBbo);
      return;
    }

    // Partial book depth, top-20 at 100ms — kind is "depth20@100ms".
    if (kind.startsWith("depth")) {
      const moving = data as BinancePartialDepth | undefined;
      if (!moving) return;
      this.emit("orderBookSnapshot", buildSnapshot(marketType, symbol, moving));
      return;
    }

    // kline_<interval>, e.g. kline_1m — data.k holds the candle.
    if (kind.startsWith("kline_")) {
      const interval = toCanonicalInterval(kind.slice("kline_".length));
      const k = (data as { k?: Record<string, unknown> } | undefined)?.k as
        | { t: number; o: string; h: string; l: string; c: string; v: string; x: boolean }
        | undefined;
      if (interval && k) {
        const candle = toCandle({
          openTime: k.t,
          open: parseFloat(k.o),
          high: parseFloat(k.h),
          low: parseFloat(k.l),
          close: parseFloat(k.c),
          volume: parseFloat(k.v),
          closed: k.x === true,
        });
        if (candle) {
          this.emit("candle", {
            exchange: "BINANCE",
            type: marketType,
            symbol,
            interval,
            candle,
          } satisfies CandleData);
        }
      }
      return;
    }

    // markPrice@1s on the futures client → funding rate for the FUT page.
    if (kind.startsWith("markPrice") && market === "futures") {
      const m = data as { s: string; r?: string; T?: number; i?: number } | undefined;
      if (!m?.r || m.T == null) return;

      // skip duplicate events (same rate and same next-funding time)
      const rateKey = `${m.r}|${m.T}`;
      if (this.lastEmittedRate.get(symbol) === rateKey) return;
      this.lastEmittedRate.set(symbol, rateKey);

      this.emit("fundingRate", {
        exchange: "BINANCE",
        symbol,
        fundingRate: parseFloat(m.r) * 100, // fraction → percent (consistent with OKX + tests)
        nextFundingTime: m.T,
      } satisfies FundingRateEvent);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers (module scope, pure → easy to unit test in isolation)
// ---------------------------------------------------------------------------

const BINANCE_STREAM_TAIL: Record<BinanceStreamKind, string> = {
  aggTrade: "aggTrade",
  bookTicker: "bookTicker",
  depth: "depth20@100ms", // full top-20 book every event → no diff sync needed
};

let nextIdCounter = 1;
function nextRequestId(): number {
  return nextIdCounter++;
}

/** Build a normalized OrderBookSnapshot from a top-20 partial-depth payload. */
export function buildSnapshot(
  type: "SPOT" | "FUT",
  symbol: string,
  raw: BinancePartialDepth,
): OrderBookSnapshot {
  const toLevel = (pair: [string, string]): OrderBookLevel | null => {
    const qty = parseFloat(pair[1] ?? "0");
    const price = parseFloat(pair[0] ?? "0");
    if (!Number.isFinite(price) || price <= 0) return null;
    if (!Number.isFinite(qty) || qty <= 0) return null;
    return { price, quantity: qty, updatedAt: Date.now() };
  };

  const bids: OrderBookLevel[] = [];
  const asks: OrderBookLevel[] = [];
  for (const pair of raw.bids ?? []) {
    const lvl = toLevel(pair);
    if (lvl) bids.push(lvl);
  }
  for (const pair of raw.asks ?? []) {
    const lvl = toLevel(pair);
    if (lvl) asks.push(lvl);
  }

  // Partial-book payload arrives already sorted best-first; normalize defensively.
  bids.sort((a, b) => b.price - a.price);
  asks.sort((a, b) => a.price - b.price);

  const bestBid = bids[0]?.price ?? null;
  const bestAsk = asks[0]?.price ?? null;
  const midPrice =
    bestBid != null && bestAsk != null && bestAsk > bestBid ? (bestBid + bestAsk) / 2 : null;

  return {
    exchange: "BINANCE",
    symbol,
    type,
    bestBid,
    bestBidQty: bids[0]?.quantity ?? null,
    bestAsk,
    bestAskQty: asks[0]?.quantity ?? null,
    midPrice,
    bids,
    asks,
    updatedAt: Date.now(),
  };
}
