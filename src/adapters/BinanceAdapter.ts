import { EventEmitter } from "events";
import { BaseWebSocketClient } from "../websocket/BaseWebSocketClient";
import type { GenericMarketData } from "../types/marketData";

type MarketType = "spot" | "futures";

interface BinanceMessage {
    e: string;
    s: string;
    p: string;
    T: number;
}

export class BinanceAdapter extends EventEmitter {
  private clients: Record<MarketType, BaseWebSocketClient>;
  private subscribedSymbols: Set<string> = new Set();

  constructor() {
    super();

    this.clients = {
      spot: new BaseWebSocketClient("wss://stream.binance.com:9443/ws", {
        autoReconnect: true,
      }),
      futures: new BaseWebSocketClient("wss://fstream.binance.com/ws", {
        autoReconnect: true,
      }),
    };

    this.setupHandlers("spot");
    this.setupHandlers("futures");
  }

  private setupHandlers(marketType: MarketType) {
    const ws = this.clients[marketType];

    ws.on("message", (msg: BinanceMessage) => {

      if (msg.e === 'aggTrade') {
        // Inline normalization: BTCUSDT -> BTC-USDT
        let symbolKey = msg.s;
        if (symbolKey.endsWith('USDT')) {
          symbolKey = symbolKey.replace('USDT', '-USDT');
        } else if (symbolKey.endsWith('BTC')) {
          symbolKey = symbolKey.replace('BTC', '-BTC');
        } else if (symbolKey.endsWith('ETH')) {
          symbolKey = symbolKey.replace('ETH', '-ETH');
        } else if (symbolKey.endsWith('BUSD')) {
          symbolKey = symbolKey.replace('BUSD', '-BUSD');
        } else if (symbolKey.endsWith('USD')) {
          symbolKey = symbolKey.replace('USD', '-USD');
        } else if (symbolKey.endsWith('EUR')) {
          symbolKey = symbolKey.replace('EUR', '-EUR');
        } else if (symbolKey.endsWith('TRY')) {
          symbolKey = symbolKey.replace('TRY', '-TRY');
        } else if (symbolKey.endsWith('BNB')) {
          symbolKey = symbolKey.replace('BNB', '-BNB');
        }
        const transformedData: GenericMarketData = {
          exchange: 'Binance',
          type: marketType === 'spot' ? 'SPOT' : 'FUT',
          symbol: symbolKey,
          currentPrice: parseFloat(msg.p),
          timeStamp: msg.T
        }
        this.emit("marketData", transformedData);
      } else if (msg.e === 'depth') {
        // Handle depth data if needed
      }
    });

    ws.on("open", () => {
      // new subscription logic here
    });

    ws.on("error", (error) => {
      console.error('Binance WebSocket error:', error);
    });
  }

  async connectAll() {
    await Promise.all([this.clients.spot.connect(), this.clients.futures.connect()]);
  }

  subscribe(symbols: string[] | string, streams: ("bookTicker" | "aggTrade" | "depth")[] = ["bookTicker"]) {
    const arr = Array.isArray(symbols) ? symbols : [symbols];
    arr.forEach((s) => this.subscribedSymbols.add(s.toUpperCase()));

    // Convert BTC-USDT to BTCUSDT for Binance API
    const params: string[] = [];
    arr.forEach((s) => {
      const binanceSymbol = s.replace("-USDT", "USDT").toLowerCase();
      streams.forEach((stream) => {
        params.push(`${binanceSymbol}@${stream}`);
      });
    });

    const payload = {
      method: "SUBSCRIBE",
      params,
      id: Date.now(),
    };

    // Send to spot and futures if connected
    Object.values(this.clients).forEach((ws) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(payload));
      }
    });
  }
}
