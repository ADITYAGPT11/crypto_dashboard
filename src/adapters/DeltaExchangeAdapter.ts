import { EventEmitter } from "events";
import { BaseWebSocketClient } from "../websocket/BaseWebSocketClient";
import type { GenericMarketData } from "../types/marketData";

interface DeltaTradeMessage {
  type: "trades";
  symbol: string; // e.g. BTCUSDT
  product_id: number;
  trades: Array<{
    price: string;
    size: number;
    side: "buy" | "sell";
    timestamp: number;
  }>;
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
  private subscribedProducts = new Set<number>();
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

      if (msg.type === "trades" && msg.trades?.length) {
        const lastTrade = msg.trades[msg.trades.length - 1];

        // Normalize BTCUSDT → BTC-USDT
        let symbolKey = msg.symbol;
        // if (symbolKey.endsWith("USDT")) {
        //   symbolKey = symbolKey.replace("USDT", "-USDT");
        // }

        const transformedData: GenericMarketData = {
          exchange: "DELTA",
          type: "FUT",
          symbol: symbolKey,
          currentPrice: parseFloat(lastTrade.price),
          timeStamp: lastTrade.timestamp,
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
    console.log("DeltaExchangeAdapter loaded products:", data.result.length, data);
    data.result.forEach((p) => {
      this.symbolToProductId.set(p.symbol.toUpperCase(), p.id);
    });

    this.productsLoaded = true;
  }

  /**
   * Convert symbol or symbols → product_id(s)
   */
  private async symbolToProductIdHelper(
    input: string | string[],
  ): Promise<number | number[] | undefined> {
    await this.preloadProducts();

    const symbols = Array.isArray(input) ? input : [input];

    const ids = symbols
      .map((s) => this.symbolToProductId.get(s.toUpperCase()))
      .filter((id): id is number => id !== undefined);

    if (!ids.length) return undefined;

    return Array.isArray(input) ? ids : ids[0];
  }

  /**
   * Subscribe using symbol(s) — auto converts to product_ids
   */
  async subscribe(symbolOrSymbols: string | string[]): Promise<void> {
    const deltaSymbol = Array.isArray(symbolOrSymbols)
      ? symbolOrSymbols.map(s => s.replace("-USDT", "USDT"))
      : symbolOrSymbols.replace("-USDT", "USDT");
    const result = await this.symbolToProductIdHelper(deltaSymbol);
    console.log("DeltaExchangeAdapter subscribe result:", result);
    if (!result) {
      console.warn("No product_id found for:", symbolOrSymbols);
      return;
    }

    const productIds = Array.isArray(result) ? result : [result];

    productIds.forEach((id) => this.subscribedProducts.add(id));

    this.ws.send({
      type: "subscribe",
      // payload: {
        channels: [
          {
            name: "mark_price",
            product_ids: productIds,
          },
        ],
      // },
    });
  }
}
