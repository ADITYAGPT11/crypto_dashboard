import EventEmitter from "eventemitter3";
import { BaseWebSocketClient } from "../websocket/BaseWebSocketClient";
import type { GenericMarketData } from "../types/marketData";

type MarketType = "spot" | "futures";

interface BinanceMessage {
  e: string;
  s: string;
  p: string;
  T: number;
  // Fields for markPriceUpdate
  P?: string;  // estimated settle price
  r?: string;  // funding rate
}

export class BinanceAdapter extends EventEmitter {
  private clients: Record<MarketType, BaseWebSocketClient>;
  private subscribedSymbols: Set<string> = new Set();
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
            fundingRate: parseFloat(msg.r),
            nextFundingTime: msg.T,
            fundingInterval: interval,
          });
        }
      }
    });

    ws.on("open", () => {
      // new subscription logic here
    });

    ws.on("error", (error) => {
      console.error("Binance WebSocket error:", error);
    });
  }

  async connectAll() {
    await Promise.all([
      this.clients.spot.connect(),
      this.clients.futures.connect(),
    ]);
  }

  subscribe(
    symbols: string[] | string,
    streams: ("bookTicker" | "aggTrade" | "depth")[] = ["bookTicker"],
  ) {
    const arr = Array.isArray(symbols) ? symbols : [symbols];
    arr.forEach((s) => this.subscribedSymbols.add(s.toUpperCase()));

    // Convert BTC-USDT to BTCUSDT for Binance API
    const params: string[] = [];
    arr.forEach((s) => {
      const binanceSymbol = s.replace("-USDT", "USDT").toLowerCase();
      streams.forEach((stream) => {
        params.push(`${binanceSymbol}@${stream}`);
      });
    });

    const payload = {
      method: "SUBSCRIBE",
      params,
      id: Date.now(),
    };

    // Send to spot and futures if connected
    Object.values(this.clients).forEach((ws) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(payload));
      }
    });
  }

  /** Subscribe to funding rate (markPrice) stream on futures only */
  subscribeFundingRate(symbols: string[] | string) {
    const arr = Array.isArray(symbols) ? symbols : [symbols];
    const params: string[] = arr.map((s) =>
      s.replace("-USDT", "USDT").toLowerCase() + "@markPrice"
    );
    const payload = {
      method: "SUBSCRIBE",
      params,
      id: Date.now(),
    };
    const ws = this.clients.futures;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }
}
