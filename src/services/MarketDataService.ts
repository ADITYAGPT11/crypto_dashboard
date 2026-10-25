import EventEmitter from "eventemitter3";
import { BinanceAdapter } from "../adapters/BinanceAdapter";
import { OkxAdapter } from "../adapters/OkxAdapter";
import { LiveMarketDataService } from "./LiveMarketDataService";
import { ArbitrageService } from "./ArbitrageService";
import { CandleService } from "./CandleService";
import { DeltaExchangeAdapter } from "../adapters/DeltaExchangeAdapter";
import type { ConnectionState, ConnectionStatusPayload } from "../types/connection";
import type { GenericMarketData, OrderBookBbo, OrderBookSnapshot } from "../types/marketData";
import { OrderBookService } from "./OrderBookService";

interface FundingRateEvent {
  exchange: string;
  symbol: string;
  fundingRate: number;
  nextFundingTime: number;
  fundingInterval?: number;
  nextFundingRate?: number;
}

export interface ConnectionStatus {
  exchange: string;
  state: ConnectionState;
}

export class MarketDataService extends EventEmitter {
  private static instance: MarketDataService | null = null;
  private binance = new BinanceAdapter();
  private okx = new OkxAdapter();
  private delta = new DeltaExchangeAdapter();
  private arbitrage = new ArbitrageService();
  private orderBookService = OrderBookService.getInstance();
  private isInitialized = false;

  // exchange → market → state; aggregated per exchange for the UI
  private connectionMarkets = new Map<string, Map<string, ConnectionState>>();

  private constructor() {
    super();
  }

  static getInstance(): MarketDataService {
    if (!MarketDataService.instance) {
      MarketDataService.instance = new MarketDataService();
    }
    return MarketDataService.instance;
  }

  static resetInstance() {
    MarketDataService.instance = null;
  }

  /**
   * Start streaming for the given symbols.
   * Each exchange connects independently: subscriptions are issued immediately
   * (queued until each socket opens) so one flaky exchange (e.g. Delta's
   * unreliable handshake) can no longer block data from the other two.
   */
  startMarketData(symbol: string | string[]) {
    const symbols = Array.isArray(symbol) ? symbol : [symbol];

    if (!this.isInitialized) {
      this.isInitialized = true;
      this.wireConnectionStatus();
      this.wireMarketDataRouting();
      void this.connectExchanges();
    } // Module 5: add bookTicker (best bid/ask) by default; depth stays for diff updates.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.binance as any).subscribe(symbols, ["aggTrade", "depth", "bookTicker"]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.binance as any).subscribeFundingRate(symbols);
    this.okx.subscribe(symbols, "SPOT");
    this.okx.subscribe(symbols, "SWAP");
    this.okx.subscribeFundingRate(symbols);
    this.delta.subscribe(symbols);
  }

  /**
   * Connect every exchange in parallel but tolerate individual failures:
   * each adapter auto-reconnects and re-subscribes on its own.
   */
  private async connectExchanges() {
    try {
      await Promise.resolve(this.binance.connect());
    } catch (error) {
      console.error("Error connecting to Binance:", error);
    }
    try {
      await this.okx.connect();
    } catch (error) {
      console.error("Error connecting to OKX:", error);
    }
    try {
      await this.delta.connect();
    } catch (error) {
      console.error("Error connecting to Delta Exchange:", error);
    }
  }

  private wireMarketDataRouting() {
    const liveService = LiveMarketDataService.getInstance();
    // Candle streams (Module 4) share the same adapters.
    CandleService.getInstance().wireAdapters({ BINANCE: this.binance, OKX: this.okx });

    const onBbo = (bbo: OrderBookBbo) => {
      this.orderBookService.setBbo(bbo.exchange, bbo.type, bbo.symbol, bbo);
      this.emit("orderBookBbo", bbo);
    };

    const onSnapshot = (snap: OrderBookSnapshot) => {
      this.orderBookService.setSnapshot(snap.exchange, snap.type, snap.symbol, snap);
      this.emit("orderBookSnapshot", snap);
    };

    const onMarketData = (msg: GenericMarketData) => {
      liveService.update(msg.exchange, msg.symbol, msg.type, msg.currentPrice, msg.timeStamp);
      this.arbitrage.onPriceUpdate(msg);
      this.emit("marketData", msg);
    };

    // Bubble indicative cross-exchange spreads up to the UI.
    this.arbitrage.on("arbitrage", (opportunity) => this.emit("arbitrage", opportunity));

    const onFundingRate = (fr: FundingRateEvent) => {
      liveService.updateFundingRate(fr.exchange, fr.symbol, {
        rate: fr.fundingRate,
        nextFundingTime: fr.nextFundingTime,
        fundingInterval: fr.fundingInterval,
        nextFundingRate: fr.nextFundingRate,
      });
      this.emit("fundingRate", fr);
    };

    const adapters = [this.binance, this.okx, this.delta];
    for (const adapter of adapters) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (adapter as any).on("marketData", onMarketData);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (adapter as any).on("fundingRate", onFundingRate);
    }
    // Module 5: wire order-book events from Binance (only source with depth in scope).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.binance as any).on("orderBookBbo", onBbo);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.binance as any).on("orderBookSnapshot", onSnapshot);
  }

  /**
   * Called by the UI when a symbol is dropped from the watchlist. Stops the
   * arbitrage engine from tracking it so no stale spread row survives removal.
   */
  removeSymbol(symbol: string) {
    this.arbitrage.forgetSymbol(symbol);
    this.emit("symbolRemoved", symbol);
  }

  private wireConnectionStatus() {
    const onStatus = (s: ConnectionStatusPayload) => this.updateConnectionState(s);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.binance as any).on("connectionStatus", onStatus);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.okx as any).on("connectionStatus", onStatus);
    this.delta.on("connectionStatus", onStatus);

    // Seed every exchange as "connecting" so the UI never shows "down" by default
    this.updateConnectionState({ exchange: "BINANCE", market: "spot", state: "connecting" });
    this.updateConnectionState({ exchange: "OKX", market: "public", state: "connecting" });
    this.updateConnectionState({ exchange: "DELTA", market: "fut", state: "connecting" });
  }

  private updateConnectionState(s: ConnectionStatusPayload) {
    const markets = this.connectionMarkets.get(s.exchange) ?? new Map<string, ConnectionState>();
    markets.set(s.market, s.state);
    this.connectionMarkets.set(s.exchange, markets);

    // Aggregate: any live socket ⇒ live; else any connecting ⇒ connecting; else down
    const states = Array.from(markets.values());
    const state: ConnectionState = states.includes("live")
      ? "live"
      : states.includes("connecting")
        ? "connecting"
        : "down";
    this.emit("connectionStatus", { exchange: s.exchange, state } satisfies ConnectionStatus);
  }
}
