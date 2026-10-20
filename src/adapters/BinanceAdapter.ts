import EventEmitter from "eventemitter3";
import { BaseWebSocketClient } from "../websocket/BaseWebSocketClient";
import type { GenericMarketData } from "../types/marketData";
import type { ConnectionStatusPayload } from "../types/connection";

type MarketType = "spot" | "futures";

interface BinanceMessage {
  e: string;
  s: string;
  p: string;
  T: number;
  // Fields for markPriceUpdate
  P?: string; // estimated settle price
  r?: string; // funding rate
}

export class BinanceAdapter extends EventEmitter {
  private clients: Record<MarketType, BaseWebSocketClient>;
  // Stream params per market (e.g. "btcusdt@aggTrade") — used to (re)subscribe on every open.
  private subscribedStreams: Record<MarketType, Set<string>> = {
    spot: new Set(),
    futures: new Set(),
  };
  private prevFundingTime: Record<string, number> = {}; // symbol → previous T

  constructor() {
    super();

    this.clients = {
      spot: new BaseWebSocketClient("wss://stream.binance.com/ws", {
        autoReconnect: true,
      }),
      futures: new BaseWebSocketClient("wss://fstream.binance.com/market/ws", {
        autoReconnect: true,
      }),
    };

    this.setupHandlers("spot");
    this.setupHandlers("futures");
  }

  private setupHandlers(marketType: MarketType) {
    const ws = this.clients[marketType];

    ws.on("message", (rawMsg) => {
      const msg = rawMsg as BinanceMessage;
      if (msg.e === "aggTrade") {
        // Inline normalization: BTCUSDT -> BTC-USDT
        let symbolKey = msg.s;
        if (symbolKey.endsWith("USDT")) {
          symbolKey = symbolKey.replace("USDT", "-USDT");
        }
        const transformedData: GenericMarketData = {
          exchange: "BINANCE",
          type: marketType === "spot" ? "SPOT" : "FUT",
          symbol: symbolKey,
          currentPrice: parseFloat(msg.p),
          timeStamp: msg.T,
        };
        this.emit("marketData", transformedData);
      } else if (msg.e === "depth") {
        // Handle depth data if needed
      } else if (msg.e === "markPriceUpdate" && marketType === "futures") {
        // Binance: r = funding rate, T = next funding time (futures only)
        if (msg.r !== undefined && msg.T !== undefined) {
          let symbolKey = msg.s;
          if (symbolKey.endsWith("USDT")) {
            symbolKey = symbolKey.replace("USDT", "-USDT");
          }
          // Derive interval from difference between consecutive T values
          let interval = 28800;
          const prevT = this.prevFundingTime[msg.s];
          if (prevT !== undefined && msg.T > prevT) {
            const computed = (msg.T - prevT) / 1000;
            if (computed > 0 && computed <= 86400) interval = computed;
          }
          this.prevFundingTime[msg.s] = msg.T;
          this.emit("fundingRate", {
            exchange: "BINANCE",
            symbol: symbolKey,
            fundingRate: parseFloat(msg.r) * 100,
            nextFundingTime: msg.T,
            fundingInterval: interval,
          });
        }
      }
    });

    ws.on("open", () => {
      // Re-send all tracked subscriptions after the initial connect and after
      // every reconnect, so a dropped socket heals itself automatically.
      this.sendSubscribe(marketType);
      this.emit("connectionStatus", {
        exchange: "BINANCE",
        market: marketType,
        state: "live",
      } satisfies ConnectionStatusPayload);
    });

    ws.on("close", () => {
      // autoReconnect will retry; report as reconnecting
      this.emit("connectionStatus", {
        exchange: "BINANCE",
        market: marketType,
        state: "connecting",
      } satisfies ConnectionStatusPayload);
    });

    ws.on("error", (error) => {
      console.error("Binance WebSocket error:", error);
    });
  }

  async connectAll() {
    await Promise.all([this.clients.spot.connect(), this.clients.futures.connect()]);
  }

  /**
   * Send SUBSCRIBE for every stream tracked for this market. Safe to call
   * before the socket opens: BaseWebSocketClient queues the payload until open.
   */
  private sendSubscribe(marketType: MarketType) {
    const params = Array.from(this.subscribedStreams[marketType]);
    if (params.length === 0) return;
    this.clients[marketType].send({
      method: "SUBSCRIBE",
      params,
      id: Date.now(),
    });
  }

  private static toBinanceStream(s: string, stream: string): string {
    return `${s.replace("-USDT", "USDT").toLowerCase()}@${stream}`;
  }

  subscribe(
    symbols: string[] | string,
    streams: ("bookTicker" | "aggTrade" | "depth")[] = ["bookTicker"],
  ) {
    const arr = Array.isArray(symbols) ? symbols : [symbols];
    const params = arr.flatMap((s) =>
      streams.map((stream) => BinanceAdapter.toBinanceStream(s, stream)),
    );

    // spot gets the market-data streams of every subscribed symbol
    this.subscribedStreams.spot = new Set([
      ...this.subscribedStreams.spot,
      ...params,
    ]);
    // futures mirrors the same streams (plus mark price via subscribeFundingRate)
    this.subscribedStreams.futures = new Set([
      ...this.subscribedStreams.futures,
      ...params,
    ]);

    this.sendSubscribe("spot");
    this.sendSubscribe("futures");
  }

  /** Subscribe to funding rate (markPrice) stream on futures only */
  subscribeFundingRate(symbols: string[] | string) {
    const arr = Array.isArray(symbols) ? symbols : [symbols];
    const params = arr.map((s) => BinanceAdapter.toBinanceStream(s, "markPrice"));

    this.subscribedStreams.futures = new Set([
      ...this.subscribedStreams.futures,
      ...params,
    ]);
    this.sendSubscribe("futures");
  }
}
