import EventEmitter from "eventemitter3";
import { stateAfterClose } from "../utils/connectionState";
import { BaseWebSocketClient } from "../websocket/BaseWebSocketClient";
import type { CandleData, CandleInterval, GenericMarketData } from "../types/marketData";
import { normalizeHistory, toCanonicalInterval, toCandle } from "../utils/candleUtils";
import { parseOkxSymbol, formatCanonicalSymbol } from "../utils/symbolUtils";
import type { ConnectionStatusPayload } from "../types/connection";

interface OkxMessage {
  arg: {
    channel: string;
    instId: string;
  };
  data: Array<OkxTickerRow | string[]>;
}

interface OkxTickerRow {
  instId: string;
  last: string;
  ts: string;
  fundingRate?: string;
  fundingTime?: string; // next settlement time
  prevFundingTime?: string; // previous settlement time
  nextFundingRate?: string; // predicted rate for next period
}

/**
 * Our interval → OKX bar name. Minutes stay lowercase, hours/days/weeks are uppercase
 * (1H, 4H). OKX's plain 6H/12H/1D/1W bars open on Hong Kong time (UTC+8); the `utc`
 * variants open on UTC like Binance and our analysis, so those are used.
 */
export function toOkxBar(interval: CandleInterval): string {
  const bar = interval.replace(/[hdw]$/, (u) => u.toUpperCase());
  return ["6H", "12H", "1D", "3D", "1W"].includes(bar) ? `${bar}utc` : bar;
}

export class OkxAdapter extends EventEmitter {
  private ws: BaseWebSocketClient;
  // Tracked subscription args (JSON of {channel, instId}) — re-sent on every open
  private trackedArgs = new Set<string>();

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
        const d = msg.data[0] as OkxTickerRow;
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
        const d = msg.data[0] as OkxTickerRow;
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
          fundingRate: parseFloat(d.fundingRate || "0") * 100,
          nextFundingTime,
          fundingInterval: interval,
          nextFundingRate: isNaN(nextFr as number) ? undefined : nextFr,
        });
      }

      // Candle channels: channel names look like "candle1m"/"candle1H"/"candle4H"...
      if (msg.arg?.channel?.startsWith("candle") && msg.data?.length) {
        const interval = toCanonicalInterval(msg.arg.channel.slice("candle".length));
        if (interval && typeof msg.data[0] !== "undefined") {
          const row = msg.data[0] as string[];
          // [ts, o, h, l, c, vol(base), volCcy, volCcyQuote, confirm("1" = closed)]
          const candle = toCandle({
            openTime: parseInt(row[0]),
            open: parseFloat(row[1]),
            high: parseFloat(row[2]),
            low: parseFloat(row[3]),
            close: parseFloat(row[4]),
            volume: parseFloat(row[5]),
            closed: row[8] === "1",
          });
          if (candle) {
            // SWAP instruments are BTC-USDT-SWAP natively; canonical drops the suffix
            const canonicalId = msg.arg.instId.replace(/-SWAP$/, "");
            const symbol = formatCanonicalSymbol(parseOkxSymbol(canonicalId));
            this.emit("candle", {
              exchange: "OKX",
              type: msg.arg.instId.includes("SWAP") ? "FUT" : "SPOT",
              symbol,
              interval,
              candle,
            } satisfies CandleData);
          }
        }
      }
    });

    this.ws.on("open", () => {
      // Re-send every tracked subscription after the initial connect and after
      // every reconnect, so a dropped socket heals itself automatically.
      this.sendAllSubscriptions();
      this.emit("connectionStatus", {
        exchange: "OKX",
        market: "public",
        state: "live",
      } satisfies ConnectionStatusPayload);
    });

    this.ws.on("close", () => {
      // autoReconnect keeps retrying; "down" once several reconnects in a row fail
      this.emit("connectionStatus", {
        exchange: "OKX",
        market: "public",
        state: stateAfterClose(this.ws.failedReconnects),
      } satisfies ConnectionStatusPayload);
    });

    this.ws.on("error", (error) => {
      console.error("OKX WebSocket error:", error);
    });
  }

  async connect() {
    await this.ws.connect();
  }

  /**
   * Add args to the tracked set and subscribe any that are new. Safe to call
   * before the socket opens: BaseWebSocketClient queues the payload until open.
   */
  private trackAndSubscribe(args: Array<{ channel: string; instId: string }>) {
    const fresh = args.filter((a) => {
      const key = JSON.stringify(a);
      if (this.trackedArgs.has(key)) return false;
      this.trackedArgs.add(key);
      return true;
    });
    if (fresh.length === 0) return;
    this.ws.send({ op: "subscribe", args: fresh });
  }

  /** Remove args from the tracked set and unsubscribe those that were tracked. */
  private untrackAndUnsubscribe(args: Array<{ channel: string; instId: string }>) {
    const gone = args.filter((a) => this.trackedArgs.delete(JSON.stringify(a)));
    if (gone.length === 0) return;
    this.ws.send({ op: "unsubscribe", args: gone });
  }

  private sendAllSubscriptions() {
    const args = Array.from(this.trackedArgs).map(
      (key) =>
        JSON.parse(key) as {
          channel: string;
          instId: string;
        },
    );
    if (args.length === 0) return;
    this.ws.send({ op: "subscribe", args });
  }

  subscribe(symbols: string | string[], type: "SPOT" | "SWAP") {
    const arr = Array.isArray(symbols) ? symbols : [symbols];
    const args = arr.map((s) => ({
      channel: "tickers",
      instId: type === "SPOT" ? s : `${s}-SWAP`,
    }));
    this.trackAndSubscribe(args);
  }

  /** Stop ticker updates (the reverse of `subscribe`). */
  unsubscribe(symbols: string | string[], type: "SPOT" | "SWAP") {
    const arr = Array.isArray(symbols) ? symbols : [symbols];
    this.untrackAndUnsubscribe(
      arr.map((s) => ({ channel: "tickers", instId: type === "SPOT" ? s : `${s}-SWAP` })),
    );
  }

  /** Stop funding-rate updates (the reverse of `subscribeFundingRate`). */
  unsubscribeFundingRate(symbols: string | string[]) {
    const arr = Array.isArray(symbols) ? symbols : [symbols];
    this.untrackAndUnsubscribe(arr.map((s) => ({ channel: "funding-rate", instId: `${s}-SWAP` })));
  }

  /** Subscribe to funding rate updates for SWAP instruments */
  subscribeFundingRate(symbols: string | string[]) {
    const arr = Array.isArray(symbols) ? symbols : [symbols];
    const args = arr.map((s) => ({
      channel: "funding-rate",
      instId: `${s}-SWAP`,
    }));
    this.trackAndSubscribe(args);
  }

  // ------------------------------------------------------------------
  // Candles (Module 4) — WS candle channels + REST history
  // ------------------------------------------------------------------

  subscribeCandles(symbols: string | string[], type: "SPOT" | "SWAP", interval: CandleInterval) {
    const arr = Array.isArray(symbols) ? symbols : [symbols];
    const args = arr.map((s) => ({
      channel: `candle${toOkxBar(interval)}`,
      instId: type === "SPOT" ? s : `${s}-SWAP`,
    }));
    this.trackAndSubscribe(args);
  }

  unsubscribeCandles(symbols: string | string[], type: "SPOT" | "SWAP", interval: CandleInterval) {
    const arr = Array.isArray(symbols) ? symbols : [symbols];
    const args = arr.map((s) => ({
      channel: `candle${toOkxBar(interval)}`,
      instId: type === "SPOT" ? s : `${s}-SWAP`,
    }));
    this.untrackAndUnsubscribe(args);
  }

  /**
   * REST history backfill (returned ascending). No key, no signing.
   * OKX serves at most 300 rows per request; when a larger `limit` is asked
   * the remaining pages are followed via `after` (records stricter-older than
   * that timestamp) so charts can load deeper history.
   */
  async fetchCandleHistory(
    symbol: string,
    interval: CandleInterval,
    type: "SPOT" | "SWAP",
    limit = 300,
    afterTs?: number,
  ): Promise<CandleData[]> {
    const instId = type === "SPOT" ? symbol : `${symbol}-SWAP`;
    const rows: string[][] = [];
    // `after` makes OKX return records strictly older than the timestamp.
    let afterParam = afterTs != null ? String(afterTs) : undefined;

    while (rows.length < limit) {
      const page = await fetchOkxCandlePage(
        instId,
        toOkxBar(interval),
        Math.min(300, limit - rows.length),
        afterParam,
      );
      if (page.length === 0) break;
      rows.push(...page);
      // OKX returns latest-first; last row's ts is the older boundary.
      const oldestTs = parseInt(page[page.length - 1][0], 10);
      if (!(oldestTs > 0)) break;
      afterParam = String(oldestTs);
    }

    const candles = normalizeHistory(
      rows.map((row) => ({
        openTime: parseInt(row[0]),
        open: parseFloat(row[1]),
        high: parseFloat(row[2]),
        low: parseFloat(row[3]),
        close: parseFloat(row[4]),
        volume: parseFloat(row[5]),
        closed: row[8] === "1",
      })),
    );
    return candles.map((candle) => ({
      exchange: "OKX" as const,
      type: type === "SPOT" ? ("SPOT" as const) : ("FUT" as const),
      symbol,
      interval,
      candle,
    }));
  }
}

/** One OKX candles API request (no more than 300 rows). */
async function fetchOkxCandlePage(
  instId: string,
  bar: string,
  limit: number,
  after?: string,
): Promise<string[][]> {
  const afterQ = after != null ? `&after=${after}` : "";
  const response = await fetch(
    `https://www.okx.com/api/v5/market/candles?instId=${instId}&bar=${bar}&limit=${limit}${afterQ}`,
    { signal: AbortSignal.timeout(10_000) },
  );
  if (!response.ok) {
    throw new Error(`OKX candles HTTP ${response.status}`);
  }
  const payload = (await response.json()) as { code: string; data: string[][] };
  if (payload.code !== "0") {
    throw new Error(`OKX candles API error ${payload.code}`);
  }
  return payload.data ?? [];
}
