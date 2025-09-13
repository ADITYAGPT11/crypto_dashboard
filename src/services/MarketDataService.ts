import { EventEmitter } from "events";
import { BinanceAdapter } from "../adapters/BinanceAdapter";
import { OkxAdapter } from "../adapters/OkxAdapter";

export class MarketDataService extends EventEmitter {
  private binance = new BinanceAdapter();
  private okx = new OkxAdapter();

  async startMarketData(symbol: string | string[]) {
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
    this.binance.on("marketData", (data) =>
      this.emit("marketData", data)
    );
    this.binance.on("connected", (e) => this.emit("connected", e));
    this.binance.on("disconnected", (e) => this.emit("disconnected", e));
    this.binance.on("error", (e) => this.emit("error", e));

    // OKX
    this.okx.on("marketData", (data) =>
      this.emit("marketData", data)
    );
    this.okx.on("connected", (e) => this.emit("connected", e));
    this.okx.on("disconnected", (e) => this.emit("disconnected", e));
    this.okx.on("error", (e) => this.emit("error", e));
  }
}
