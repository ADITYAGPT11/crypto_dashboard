import { EventEmitter } from "events";
import { BinanceAdapter } from "../adapters/BinanceAdapter";
import { OkxAdapter } from "../adapters/OkxAdapter";

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
    // Always allow re-initialization for new symbols
    if (this.isInitialized) {
      this.binance.subscribe(symbol, ["aggTrade" , "depth"]);
      this.okx.subscribe(symbol, "SPOT");
      this.okx.subscribe(symbol, "SWAP");
      return;
    }

    try {
      // connect all exchanges in parallel
      await Promise.all([
        this.binance.connectAll(),
        this.okx.connect()
      ]);

      // subscribe to spot + futures/swap
      this.binance.subscribe(symbol, ["aggTrade" , "depth"]);
      this.okx.subscribe(symbol, "SPOT");
      this.okx.subscribe(symbol, "SWAP");

      // ---------- Forward Events ----------
      // Binance
      this.binance.on("marketData", (data) => {
        this.emit("marketData", data);
      });
      this.binance.on("connected", (e) => {
        this.emit("connected", e);
      });
      this.binance.on("disconnected", (e) => {
        this.emit("disconnected", e);
      });
      this.binance.on("error", (e) => {
        this.emit("error", e);
      });

      // OKX
      this.okx.on("marketData", (data) => {
        this.emit("marketData", data);
      });
      this.okx.on("connected", (e) => {
        this.emit("connected", e);
      });
      this.okx.on("disconnected", (e) => {
        this.emit("disconnected", e);
      });
      this.okx.on("error", (e) => {
        this.emit("error", e);
      });

      this.isInitialized = true;
    } catch (error) {
      console.error('Error initializing MarketDataService:', error);
    }
  }
}
