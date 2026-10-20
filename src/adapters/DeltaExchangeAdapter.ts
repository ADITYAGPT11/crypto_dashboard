import EventEmitter from "eventemitter3";
import { BaseWebSocketClient } from "../websocket/BaseWebSocketClient";
import type { GenericMarketData } from "../types/marketData";

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

interface DeltaProduct {
  id: number;
  symbol: string;
  contract_type: string;
  underlying_asset: string;
  quoting_asset: string;
  state: string;
}

interface DeltaProductsResponse {
  success: boolean;
  result: DeltaProduct[];
}

export class DeltaExchangeAdapter extends EventEmitter {
  private ws: BaseWebSocketClient;
  private subscribedProducts = new Set<number | string>();
  private symbolToProductId = new Map<string, number>();
  private productsLoaded = false;

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
        // Normalize Delta format → canonical BTC-USDT
        let symbolKey = msg.sy;
        if (symbolKey.endsWith("USDT") && !symbolKey.includes("-")) {
          symbolKey = symbolKey.slice(0, -4) + "-USDT";
        } else if (symbolKey.endsWith("USD") && !symbolKey.includes("-")) {
          symbolKey = symbolKey.slice(0, -3) + "-USDT";
        }

        const transformedData: GenericMarketData = {
          exchange: "DELTA",
          type: "FUT",
          symbol: symbolKey,
          currentPrice: parseFloat(msg.p),
          timeStamp: msg.ts / 1000, // microseconds → ms
        };

        this.emit("marketData", transformedData);
      }

      // Handle funding_rate channel (Delta India sends flat message with sy/fr/nfr)
      const frMsg = rawMsg as DeltaFundingRateMessage;
      if (frMsg.type === "funding_rate" && frMsg.sy) {
        let symbolKey = frMsg.sy;
        if (symbolKey.endsWith("USDT") && !symbolKey.includes("-")) {
          symbolKey = symbolKey.slice(0, -4) + "-USDT";
        } else if (symbolKey.endsWith("USD") && !symbolKey.includes("-")) {
          symbolKey = symbolKey.slice(0, -3) + "-USDT";
        }
        this.emit("fundingRate", {
          exchange: "DELTA",
          symbol: symbolKey,
          fundingRate: frMsg.fr,
          nextFundingTime: Math.floor(frMsg.nfr / 1000), // microseconds → ms
          fundingInterval: frMsg.fi, // already in seconds
        });
      }
    });

    // Re-subscribe all tracked symbols whenever the WebSocket (re)connects
    this.ws.on("open", () => {
      if (this.subscribedProducts.size > 0) {
        const symbols = Array.from(this.subscribedProducts);
        this.ws.send({
          type: "subscribe",
          payload: {
            channels: [
              { name: "trades", symbols },
              { name: "funding_rate", symbols },
            ],
          },
        });
      }
    });

    this.ws.on("error", (err) => {
      console.error("Delta Exchange WebSocket error:", err);
    });
  }

  async connect() {
    await this.ws.connect();

    // optional preload so first subscribe has zero delay
    await this.preloadProducts();
  }

  /**
   * Preload product list once
   */
  private async preloadProducts() {
    if (this.productsLoaded) return;
    const res = await fetch("https://api.delta.exchange/v2/products");

    const data: DeltaProductsResponse = await res.json();
    data.result.forEach((p) => {
      this.symbolToProductId.set(p.symbol.toUpperCase(), p.id);
    });

    this.productsLoaded = true;
  }

  /**
   * Convert symbol or symbols → product_id(s)
   */
  // private async symbolToProductIdHelper(
  //   input: string | string[],
  // ): Promise<number | number[] | undefined> {
  //   await this.preloadProducts();

  //   const symbols = Array.isArray(input) ? input : [input];

  //   const ids = symbols
  //     .map((s) => this.symbolToProductId.get(s.toUpperCase()))
  //     .filter((id): id is number => id !== undefined);

  //   if (!ids.length) return undefined;

  //   return Array.isArray(input) ? ids : ids[0];
  // }

  /**
   * Subscribe using symbol(s) — auto converts to product_ids
   */
  async subscribe(symbolOrSymbols: string | string[]): Promise<void> {
    // Delta India uses USD-quoted symbols (BTCUSD) not USDT-quoted (BTCUSDT)
    const deltaSymbol = Array.isArray(symbolOrSymbols)
      ? symbolOrSymbols.map((s) => s.replace("-USDT", "USD"))
      : symbolOrSymbols.replace("-USDT", "USD");
    const result = deltaSymbol; // await this.symbolToProductIdHelper(deltaSymbol);
    if (!result) {
      console.warn("No product_id found for:", symbolOrSymbols);
      return;
    }

    const productIds = Array.isArray(result) ? result : [result];

    productIds.forEach((id) => this.subscribedProducts.add(id));

    this.ws.send({
      type: "subscribe",
      payload: {
        channels: [
          { name: "trades", symbols: productIds },
          { name: "funding_rate", symbols: productIds },
        ],
      },
    });
  }
}
