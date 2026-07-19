import EventEmitter from "eventemitter3";
import { BaseWebSocketClient } from "../websocket/BaseWebSocketClient";
import type { GenericMarketData } from "../types/marketData";
import { parseOkxSymbol, formatCanonicalSymbol } from "../utils/symbolUtils";

type Subscription = { symbol: string; type: "SPOT" | "SWAP" };

interface OkxMessage {
  arg: {
    channel: string;
    instId: string;
  };
  data: Array<{
    instId: string;
    last: string;
    ts: string;
    fundingRate?: string;
    fundingTime?: string; // next settlement time
    prevFundingTime?: string; // previous settlement time
    nextFundingRate?: string; // predicted rate for next period
  }>;
}

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
    this.ws.on("message", (rawMsg) => {
      const msg = rawMsg as OkxMessage;
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

      // Handle funding-rate channel
      if (msg.arg?.channel === "funding-rate" && msg.data?.length) {
        const d = msg.data[0];
        const symbol = formatCanonicalSymbol(parseOkxSymbol(d.instId));
        // OKX sends next settlement time in 'fundingTime' (not 'nextFundingTime')
        // 'nextFundingTime' is the one AFTER next (16h from now)
        const nextFundingTime = d.fundingTime ? parseInt(d.fundingTime) : 0;
        const nextFr = d.nextFundingRate ? parseFloat(d.nextFundingRate) : undefined;
        // Derive interval from actual data: prevFundingTime → fundingTime
        let interval = 28800; // default 8h
        if (d.fundingTime && d.prevFundingTime) {
          const computed = (parseInt(d.fundingTime) - parseInt(d.prevFundingTime)) / 1000;
          if (computed > 0 && computed <= 86400) interval = computed;
        }
        this.emit("fundingRate", {
          exchange: "OKX",
          symbol,
          fundingRate: parseFloat(d.fundingRate || "0"),
          nextFundingTime,
          fundingInterval: interval,
          nextFundingRate: isNaN(nextFr as number) ? undefined : nextFr,
        });
      }
    });

    this.ws.on("open", () => {});

    this.ws.on("error", (error) => {
      console.error("OKX WebSocket error:", error);
    });
  }

  async connect() {
    await this.ws.connect();
  }

  subscribe(symbols: string | string[], type: "SPOT" | "SWAP") {
    const arr = Array.isArray(symbols) ? symbols : [symbols];

    arr.forEach((s) => {
      if (
        !this.subscribed.find((sub) => sub.symbol === s && sub.type === type)
      ) {
        this.subscribed.push({ symbol: s, type });
      }
    });

    const args = arr.map((s) => ({
      channel: "tickers",
      instId: type === "SPOT" ? s : `${s}-SWAP`,
    }));

    this.ws.send({ op: "subscribe", args });
  }

  /** Subscribe to funding rate updates for SWAP instruments */
  subscribeFundingRate(symbols: string | string[]) {
    const arr = Array.isArray(symbols) ? symbols : [symbols];
    const args = arr.map((s) => ({
      channel: "funding-rate",
      instId: `${s}-SWAP`,
    }));
    this.ws.send({ op: "subscribe", args });
  }
}
