import { EventEmitter } from "events";
import { BaseWebSocketClient } from "../websocket/BaseWebSocketClient";
import type { GenericMarketData } from "../types/marketData";

type Subscription = { symbol: string; type: "SPOT" | "SWAP" };

export class OkxAdapter extends EventEmitter {
  private ws: BaseWebSocketClient;
  private subscribed: Subscription[] = [];

  constructor() {
    super();
    this.ws = new BaseWebSocketClient("wss://ws.okx.com:8443/ws/v5/public", {
      autoReconnect: true,
    });
    this.setupHandlers();
  }

  private setupHandlers() {
    this.ws.on("message", (msg) => {
      if (msg.arg?.channel === "tickers" && msg.data?.length) {
        const d = msg.data[0];
        const transformedData: GenericMarketData = {
          exchange: "OKX",
          type: d.instId.includes("SWAP") ? "FUT" : "SPOT",
          symbol: d.instId,
          currentPrice: parseFloat(d.last),
          timeStamp: parseInt(d.ts),
        };
        this.emit("marketData", transformedData);
      }
    });
  }

  async connect() {
    await this.ws.connect();
    console.log("✅ OKX WebSocket connected");
  }

  subscribe(symbols: string | string[], type: "SPOT" | "SWAP") {
    const arr = Array.isArray(symbols) ? symbols : [symbols];

    arr.forEach((s) => {
      if (!this.subscribed.find((sub) => sub.symbol === s && sub.type === type)) {
        this.subscribed.push({ symbol: s, type });
      }
    });

    const args = arr.map((s) => ({
      channel: "tickers",
      instId: type === "SPOT" ? `${s}-USDT` : `${s}-USDT-SWAP`,
    }));

    this.ws.send({ op: "subscribe", args });
  }
}
