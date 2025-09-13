import { EventEmitter } from "events";
import { BaseWebSocketClient } from "../websocket/BaseWebSocketClient";
import type { GenericMarketData } from "../types/marketData";

type MarketType = "spot" | "futures";

export class BinanceAdapter extends EventEmitter {
  private clients: Record<MarketType, BaseWebSocketClient>;
  private subscribedSymbols: Set<string> = new Set();

  constructor() {
    super();

    this.clients = {
      spot: new BaseWebSocketClient("wss://stream.binance.com:9443/ws", {
        autoReconnect: true,
      }),
      futures: new BaseWebSocketClient("wss://fstream.binance.com/ws", {
        autoReconnect: true,
      }),
    };

    this.setupHandlers("spot");
    this.setupHandlers("futures");
  }

  private setupHandlers(marketType: MarketType) {
    const ws = this.clients[marketType];

    ws.on("message", (msg) => {
      if(msg.e === 'aggTrade') {
        const transformedData : GenericMarketData = {
          exchange: 'Binance',
          type: marketType === 'spot' ? 'SPOT' : 'FUT',
          symbol: msg.s,
          currentPrice: parseFloat(msg.p),
          timeStamp: msg.T
        }
        this.emit("marketData", transformedData);

      }
    });
  }

  async connectAll() {
    await Promise.all([this.clients.spot.connect(), this.clients.futures.connect()]);
    console.log("✅ Binance connected (spot + futures)");
  }

  subscribe(symbols: string[] | string, streams: ("bookTicker" | "aggTrade" | "depth")[] = ["bookTicker"]) {
  const arr = Array.isArray(symbols) ? symbols : [symbols];
  arr.forEach((s) => this.subscribedSymbols.add(s.toLowerCase()));

  // Generate all stream subscriptions
  const params: string[] = [];
  arr.forEach((s) => {
    streams.forEach((stream) => {
      params.push(`${s.toLowerCase()}usdt@${stream}`);
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
}
