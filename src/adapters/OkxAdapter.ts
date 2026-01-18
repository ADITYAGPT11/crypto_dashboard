import { EventEmitter } from "events";
import { BaseWebSocketClient } from "../websocket/BaseWebSocketClient";
import type { GenericMarketData } from "../types/marketData";
import { parseOkxSymbol, formatCanonicalSymbol } from "../utils/symbolUtils";

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
        // d.instId is already in BTC-USDT or BTC-USDT-SWAP format
        const transformedData: GenericMarketData = {
          exchange: "OKX",
          type: d.instId.includes("SWAP") ? "FUT" : "SPOT",
          symbol: formatCanonicalSymbol(parseOkxSymbol(d.instId)),
          currentPrice: parseFloat(d.last),
          timeStamp: parseInt(d.ts),
        };
        this.emit("marketData", transformedData);
      }
    });

    this.ws.on("open", () => {
    });

    this.ws.on("error", (error) => {
      console.error('OKX WebSocket error:', error);
    });
  }

  async connect() {
    await this.ws.connect();
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
      instId: type === "SPOT" ? s : `${s}-SWAP`,
    }));

    this.ws.send({ op: "subscribe", args });
  }
}
