import EventEmitter from "eventemitter3";
import { BaseWebSocketClient } from "../websocket/BaseWebSocketClient";
import type { GenericMarketData } from "../types/marketData";
import type { ConnectionStatusPayload } from "../types/connection";

interface DeltaTradeMessage {
  type: "trades";
  sy: string; // symbol, e.g. "BTCUSD"
  p: string; // price, e.g. "64612.0"
  s: number; // size
  ts: number; // timestamp in microseconds
}

interface DeltaFundingRateMessage {
  type: "funding_rate";
  sy: string; // symbol, e.g. "BTCUSD"
  fr: number; // funding rate (already a number, e.g. 0.01)
  nfr: number; // next funding time in microseconds
  fi: number; // funding interval in seconds (e.g. 28800 for 8h)
}

interface DeltaSubscribeMsg {
  type: "subscribe";
  payload: {
    channels: Array<{
      name: string;
      symbols: Array<number | string>;
    }>;
  };
}

function normalizeDeltaSymbol(symbolKey: string): string {
  // Normalize Delta format → canonical BTC-USDT
  if (symbolKey.endsWith("USDT") && !symbolKey.includes("-")) {
    return symbolKey.slice(0, -4) + "-USDT";
  }
  if (symbolKey.endsWith("USD") && !symbolKey.includes("-")) {
    return symbolKey.slice(0, -3) + "-USDT";
  }
  return symbolKey;
}

export class DeltaExchangeAdapter extends EventEmitter {
  private ws: BaseWebSocketClient;
  // Tracked instrument symbols — re-sent on every (re)connect
  private subscribedSymbols = new Set<number | string>();

  constructor() {
    super();
    this.ws = new BaseWebSocketClient("wss://public-socket.india.delta.exchange", {
      autoReconnect: true,
    });
    this.setupHandlers();
  }

  private setupHandlers() {
    this.ws.on("message", (rawMsg) => {
      const msg = rawMsg as DeltaTradeMessage;

      if (msg.type === "trades") {
        const transformedData: GenericMarketData = {
          exchange: "DELTA",
          type: "FUT",
          symbol: normalizeDeltaSymbol(msg.sy),
          currentPrice: parseFloat(msg.p),
          timeStamp: msg.ts / 1000, // microseconds → ms
        };

        this.emit("marketData", transformedData);
      }

      // Handle funding_rate channel (Delta India sends flat message with sy/fr/nfr)
      const frMsg = rawMsg as DeltaFundingRateMessage;
      if (frMsg.type === "funding_rate" && frMsg.sy) {
        this.emit("fundingRate", {
          exchange: "DELTA",
          symbol: normalizeDeltaSymbol(frMsg.sy),
          fundingRate: frMsg.fr,
          nextFundingTime: Math.floor(frMsg.nfr / 1000), // microseconds → ms
          fundingInterval: frMsg.fi, // already in seconds
        });
      }
    });

    // Re-subscribe all tracked symbols whenever the WebSocket (re)connects
    this.ws.on("open", () => {
      this.sendSubscribe();
      this.emit("connectionStatus", {
        exchange: "DELTA",
        market: "fut",
        state: "live",
      } satisfies ConnectionStatusPayload);
    });

    this.ws.on("close", () => {
      // autoReconnect will retry; report as reconnecting
      this.emit("connectionStatus", {
        exchange: "DELTA",
        market: "fut",
        state: "connecting",
      } satisfies ConnectionStatusPayload);
    });

    this.ws.on("error", (err) => {
      console.error("Delta Exchange WebSocket error:", err);
    });
  }

  async connect() {
    await this.ws.connect();
  }

  private sendSubscribe() {
    const symbols = Array.from(this.subscribedSymbols);
    if (symbols.length === 0) return;
    const payload: DeltaSubscribeMsg = {
      type: "subscribe",
      payload: {
        channels: [
          { name: "trades", symbols },
          { name: "funding_rate", symbols },
        ],
      },
    };
    this.ws.send(payload);
  }

  /**
   * Subscribe using canonical symbol(s) (BTC-USDT). Delta India uses
   * USD-quoted instruments (BTCUSD), so -USDT is mapped to -USD.
   * Safe to call before the socket opens: BaseWebSocketClient queues
   * the payload until open.
   */
  subscribe(symbolOrSymbols: string | string[]): void {
    const symbols = Array.isArray(symbolOrSymbols)
      ? symbolOrSymbols
      : [symbolOrSymbols];

    symbols.forEach((s) => this.subscribedSymbols.add(s.replace("-USDT", "USD")));
    this.sendSubscribe();
  }
}
