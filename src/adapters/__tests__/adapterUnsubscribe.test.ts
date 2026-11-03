/**
 * Removing a symbol must unsubscribe its streams. These tests spy on
 * BaseWebSocketClient.send (nothing connects: send only queues) and check each
 * adapter sends the reverse of what it subscribed, once, and forgets the stream
 * so it is not re-sent on reconnect.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { MockInstance } from "vite-plus/test";
import { BaseWebSocketClient } from "../../websocket/BaseWebSocketClient";
import { BinanceAdapter } from "../BinanceAdapter";
import { OkxAdapter } from "../OkxAdapter";
import { DeltaExchangeAdapter } from "../DeltaExchangeAdapter";

let send: MockInstance<(payload: unknown) => void>;

beforeEach(() => {
  send = vi.spyOn(BaseWebSocketClient.prototype, "send").mockImplementation(() => {});
});

afterEach(() => {
  send.mockRestore();
});

/** Payloads sent since the last call, then reset. */
function sent(): unknown[] {
  const payloads = send.mock.calls.map((call) => call[0]);
  send.mockClear();
  return payloads;
}

describe("BinanceAdapter unsubscribe", () => {
  it("unsubscribes the symbol's streams on both markets and only once", () => {
    const binance = new BinanceAdapter();
    binance.subscribe(["BTC-USDT", "ETH-USDT"], ["aggTrade", "bookTicker"]);
    binance.subscribeFundingRate(["BTC-USDT"]);
    sent();

    binance.unsubscribe("BTC-USDT", ["aggTrade", "bookTicker"]);
    binance.unsubscribeFundingRate("BTC-USDT");
    const msgs = sent() as Array<{ method: string; params: string[] }>;

    expect(msgs.map((m) => m.method)).toEqual(["UNSUBSCRIBE", "UNSUBSCRIBE", "UNSUBSCRIBE"]);
    expect(msgs[0].params).toEqual(["btcusdt@aggTrade", "btcusdt@bookTicker"]);
    expect(msgs[1].params).toEqual(["btcusdt@aggTrade", "btcusdt@bookTicker"]);
    expect(msgs[2].params).toEqual(["btcusdt@markPrice@1s"]);

    binance.unsubscribe("BTC-USDT", ["aggTrade", "bookTicker"]);
    expect(sent()).toEqual([]);
  });

  it("can subscribe again after removal", () => {
    const binance = new BinanceAdapter();
    binance.subscribe("BTC-USDT", ["aggTrade"]);
    binance.unsubscribe("BTC-USDT", ["aggTrade"]);
    sent();
    binance.subscribe("BTC-USDT", ["aggTrade"]);
    const msgs = sent() as Array<{ method: string }>;
    expect(msgs.map((m) => m.method)).toEqual(["SUBSCRIBE", "SUBSCRIBE"]);
  });
});

describe("OkxAdapter unsubscribe", () => {
  it("unsubscribes tickers and funding, leaving other symbols alone", () => {
    const okx = new OkxAdapter();
    okx.subscribe(["BTC-USDT", "ETH-USDT"], "SPOT");
    okx.subscribeFundingRate(["BTC-USDT"]);
    sent();

    okx.unsubscribe("BTC-USDT", "SPOT");
    okx.unsubscribeFundingRate("BTC-USDT");
    okx.unsubscribe("BTC-USDT", "SWAP"); // never subscribed: nothing sent
    expect(sent()).toEqual([
      { op: "unsubscribe", args: [{ channel: "tickers", instId: "BTC-USDT" }] },
      { op: "unsubscribe", args: [{ channel: "funding-rate", instId: "BTC-USDT-SWAP" }] },
    ]);
  });
});

describe("DeltaExchangeAdapter unsubscribe", () => {
  it("unsubscribes the mapped USD instrument from trades and funding", () => {
    const delta = new DeltaExchangeAdapter();
    delta.subscribe(["BTC-USDT", "ETH-USDT"]);
    sent();

    delta.unsubscribe("BTC-USDT");
    delta.unsubscribe("BTC-USDT");
    expect(sent()).toEqual([
      {
        type: "unsubscribe",
        payload: {
          channels: [
            { name: "trades", symbols: ["BTCUSD"] },
            { name: "funding_rate", symbols: ["BTCUSD"] },
          ],
        },
      },
    ]);
  });
});
