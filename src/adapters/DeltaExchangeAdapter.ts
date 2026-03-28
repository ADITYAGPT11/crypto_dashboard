import EventEmitter from "eventemitter3";
import { BaseWebSocketClient } from "../websocket/BaseWebSocketClient";
import type { GenericMarketData } from "../types/marketData";

interface DeltaTradeMessage {
  type: "all_trades";
  symbol: string; // e.g. BTCUSDT
  product_id: number;
  price: string;
  timestamp: number;
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
    this.ws = new BaseWebSocketClient("wss://socket.delta.exchange", {
      autoReconnect: true,
    });
    this.setupHandlers();
  }

  private setupHandlers() {
    this.ws.on("message", (rawMsg) => {
      const msg = rawMsg as DeltaTradeMessage;

      if (msg.type === "all_trades") {

        // Normalize BTCUSDT → BTC-USDT
        let symbolKey = msg.symbol;
        if (symbolKey.endsWith("USDT")) {
          symbolKey = symbolKey.replace("USDT", "-USDT");
        }

        const transformedData: GenericMarketData = {
          exchange: "DELTA",
          type: "FUT",
          symbol: symbolKey,
          currentPrice: parseFloat(msg.price),
          timeStamp: msg.timestamp,
        };

        this.emit("marketData", transformedData);
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
    const deltaSymbol = Array.isArray(symbolOrSymbols)
      ? symbolOrSymbols.map((s) => s.replace("-USDT", "USDT"))
      : symbolOrSymbols.replace("-USDT", "USDT");
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
          {
            name: "all_trades",
            symbols: productIds,
          },
        ],
      },
    });
  }
}
