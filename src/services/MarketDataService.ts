import EventEmitter from "eventemitter3";
import { BinanceAdapter } from "../adapters/BinanceAdapter";
import { OkxAdapter } from "../adapters/OkxAdapter";
import { LiveMarketDataService } from "./LiveMarketDataService";
import { DeltaExchangeAdapter } from "../adapters/DeltaExchangeAdapter";

export class MarketDataService extends EventEmitter {
  private static instance: MarketDataService | null = null;
  private binance = new BinanceAdapter();
  private okx = new OkxAdapter();
  private delta = new DeltaExchangeAdapter();
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
      this.binance.subscribeFundingRate(symbol);
      this.okx.subscribe(symbol, "SPOT");
      this.okx.subscribe(symbol, "SWAP");
      this.okx.subscribeFundingRate(symbol);
      this.delta.subscribe(symbol);
      return;
    }

    try {
      await Promise.all([this.binance.connectAll(), this.okx.connect(), this.delta.connect()]);

      this.binance.subscribe(symbol, ["aggTrade", "depth"]);
      this.binance.subscribeFundingRate(symbol);
      this.okx.subscribe(symbol, "SPOT");
      this.okx.subscribe(symbol, "SWAP");
      this.okx.subscribeFundingRate(symbol);
      this.delta.subscribe(symbol);

      const liveService = LiveMarketDataService.getInstance();

      // BINANCE
      this.binance.on("marketData", (msg) => {
        liveService.update(msg.exchange, msg.symbol, msg.type, msg.currentPrice);
        this.emit("marketData", msg);
      });
      this.binance.on("fundingRate", (fr) => {
        liveService.updateFundingRate(fr.exchange, fr.symbol, {
          rate: fr.fundingRate,
          nextFundingTime: fr.nextFundingTime,
          fundingInterval: fr.fundingInterval,
          nextFundingRate: fr.nextFundingRate,
        });
        this.emit("fundingRate", fr);
      });

      // OKX
      this.okx.on("marketData", (msg) => {
        liveService.update(msg.exchange, msg.symbol, msg.type, msg.currentPrice);
        this.emit("marketData", msg);
      });
      this.okx.on("fundingRate", (fr) => {
        liveService.updateFundingRate(fr.exchange, fr.symbol, {
          rate: fr.fundingRate,
          nextFundingTime: fr.nextFundingTime,
          fundingInterval: fr.fundingInterval,
          nextFundingRate: fr.nextFundingRate,
        });
        this.emit("fundingRate", fr);
      });

      // DELTA EXCHANGE
      this.delta.on("marketData", (msg) => {
        liveService.update(msg.exchange, msg.symbol, msg.type, msg.currentPrice);
        this.emit("marketData", msg);
      });
      this.delta.on("fundingRate", (fr) => {
        liveService.updateFundingRate(fr.exchange, fr.symbol, {
          rate: fr.fundingRate,
          nextFundingTime: fr.nextFundingTime,
          fundingInterval: fr.fundingInterval,
          nextFundingRate: fr.nextFundingRate,
        });
        this.emit("fundingRate", fr);
      });

      this.isInitialized = true;
    } catch (error) {
      console.error("Error initializing MarketDataService:", error);
    }
  }
}
