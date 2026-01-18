import { EventEmitter } from "events";
import { BinanceAdapter } from "../adapters/BinanceAdapter";
import { OkxAdapter } from "../adapters/OkxAdapter";
import { LiveMarketDataService } from "./LiveMarketDataService";

export class MarketDataService extends EventEmitter {
  private static instance: MarketDataService | null = null;
  private binance = new BinanceAdapter();
  private okx = new OkxAdapter();
  private isInitialized = false;

  private constructor() {
    super();
  }

  static getInstance(): MarketDataService {
    if (!MarketDataService.instance) {
      MarketDataService.instance = new MarketDataService();
    }
    return MarketDataService.instance;
  }

  async startMarketData(symbol: string | string[]) {
    if (this.isInitialized) {
      this.binance.subscribe(symbol, ["aggTrade", "depth"]);
      this.okx.subscribe(symbol, "SPOT");
      this.okx.subscribe(symbol, "SWAP");
      return;
    }

    try {
      await Promise.all([this.binance.connectAll(), this.okx.connect()]);

      this.binance.subscribe(symbol, ["aggTrade", "depth"]);
      this.okx.subscribe(symbol, "SPOT");
      this.okx.subscribe(symbol, "SWAP");

      const liveService = LiveMarketDataService.getInstance();

      // BINANCE
      this.binance.on("marketData", (msg) => {
        liveService.update(
          msg.exchange,
          msg.symbol,
          msg.type,
          msg.currentPrice,
        );

        this.emit("marketData", msg);
      });

      // OKX
      this.okx.on("marketData", (msg) => {
        liveService.update(
          msg.exchange,
          msg.symbol,
          msg.type,
          msg.currentPrice,
        );

        this.emit("marketData", msg);
      });

      this.isInitialized = true;
    } catch (error) {
      console.error("Error initializing MarketDataService:", error);
    }
  }
}
