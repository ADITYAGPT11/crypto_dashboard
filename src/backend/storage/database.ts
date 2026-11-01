/**
 * SQLite Database Layer (Module 8 - Historical Storage)
 *
 * Stores candles, trades, and order book snapshots for:
 * - Historical data replay
 * - Alert rule testing against historical events
 * - Data gap analysis
 *
 * Uses Node.js built-in node:sqlite (available in Node.js 22.5+)
 */

import { DatabaseSync } from "node:sqlite";
import type { Candle, TradeEvent, OrderBookSnapshot } from "../../types/marketData";
import type { ExchangeName, MarketType, CandleInterval } from "../../types/marketData";
import { candleKey, orderBookKey } from "../../types/marketData";
import { statSync, existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export interface StorageConfig {
  dbPath: string;
  maxRetentionDays: number;
  maxRowsPerTable: number;
}

export class HistoricalDatabase {
  private db: DatabaseSync;
  private config: StorageConfig;

  constructor(
    config: StorageConfig = {
      dbPath: "./data/history.db",
      maxRetentionDays: 30,
      maxRowsPerTable: 1000000,
    },
  ) {
    this.config = config;

    // Ensure data directory exists
    const dataDir = dirname(config.dbPath);
    mkdir(dataDir, { recursive: true }).catch(() => {});

    // Open/create database
    this.db = new DatabaseSync(config.dbPath);
    this.initialize();
  }

  private initialize(): void {
    // Enable WAL mode for better concurrent performance
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");

    // Create candles table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS candles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT NOT NULL,
        exchange TEXT NOT NULL,
        symbol TEXT NOT NULL,
        type TEXT NOT NULL,
        interval TEXT NOT NULL,
        open_time INTEGER NOT NULL,
        open REAL NOT NULL,
        high REAL NOT NULL,
        low REAL NOT NULL,
        close REAL NOT NULL,
        volume REAL NOT NULL,
        closed INTEGER NOT NULL DEFAULT 0,
        stored_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
        UNIQUE(key, open_time)
      );

      CREATE INDEX IF NOT EXISTS idx_candles_key_open ON candles(key, open_time);
      CREATE INDEX IF NOT EXISTS idx_candles_exchange_symbol ON candles(exchange, symbol, type);
    `);

    // Create trades table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS trades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        exchange TEXT NOT NULL,
        symbol TEXT NOT NULL,
        type TEXT NOT NULL,
        price REAL NOT NULL,
        quantity REAL NOT NULL,
        buyer_maker INTEGER NOT NULL,
        time_stamp INTEGER NOT NULL,
        stored_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
      );

      CREATE INDEX IF NOT EXISTS idx_trades_exchange_symbol ON trades(exchange, symbol, type);
      CREATE INDEX IF NOT EXISTS idx_trades_time ON trades(time_stamp);
    `);

    // Create order_books table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS order_books (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT NOT NULL,
        exchange TEXT NOT NULL,
        symbol TEXT NOT NULL,
        type TEXT NOT NULL,
        best_bid REAL,
        best_bid_qty REAL,
        best_ask REAL,
        best_ask_qty REAL,
        mid_price REAL,
        bids_json TEXT,
        asks_json TEXT,
        updated_at INTEGER NOT NULL,
        stored_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
      );

      CREATE INDEX IF NOT EXISTS idx_order_books_key ON order_books(key);
      CREATE INDEX IF NOT EXISTS idx_order_books_exchange_symbol ON order_books(exchange, symbol, type);
      CREATE INDEX IF NOT EXISTS idx_order_books_updated ON order_books(updated_at);
    `);

    // Run cleanup on initialization
    this.cleanupOldData();
  }

  // -----------------------------------------------------------------------
  // Candle Operations
  // -----------------------------------------------------------------------

  storeCandle(
    candle: Candle,
    exchange: ExchangeName,
    symbol: string,
    type: MarketType,
    interval: CandleInterval,
  ): void {
    const key = candleKey(exchange, type, symbol, interval);
    this.db
      .prepare(`
      INSERT OR REPLACE INTO candles (key, exchange, symbol, type, interval, open_time, open, high, low, close, volume, closed)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
      .run(
        key,
        exchange,
        symbol,
        type,
        interval,
        candle.openTime,
        candle.open,
        candle.high,
        candle.low,
        candle.close,
        candle.volume,
        candle.closed ? 1 : 0,
      );

    this.enforceRowLimit("candles");
  }

  storeCandles(
    candles: Candle[],
    exchange: ExchangeName,
    symbol: string,
    type: MarketType,
    interval: CandleInterval,
  ): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO candles (key, exchange, symbol, type, interval, open_time, open, high, low, close, volume, closed)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const candle of candles) {
      const key = candleKey(exchange, type, symbol, interval);
      stmt.run(
        key,
        exchange,
        symbol,
        type,
        interval,
        candle.openTime,
        candle.open,
        candle.high,
        candle.low,
        candle.close,
        candle.volume,
        candle.closed ? 1 : 0,
      );
    }

    this.enforceRowLimit("candles");
  }

  getCandles(
    exchange: ExchangeName,
    symbol: string,
    type: MarketType,
    interval: CandleInterval,
    startTime?: number,
    endTime?: number,
    limit: number = 1000,
  ): Candle[] {
    const key = candleKey(exchange, type, symbol, interval);
    let query = `SELECT open_time, open, high, low, close, volume, closed FROM candles WHERE key = ?`;
    const params: (string | number)[] = [key];

    if (startTime) {
      query += " AND open_time >= ?";
      params.push(startTime);
    }
    if (endTime) {
      query += " AND open_time <= ?";
      params.push(endTime);
    }

    query += " ORDER BY open_time ASC LIMIT ?";
    params.push(limit);

    const rows = this.db.prepare(query).all(...params) as Array<{
      open_time: number;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
      closed: number;
    }>;

    return rows.map((row) => ({
      openTime: row.open_time,
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      volume: row.volume,
      closed: row.closed === 1,
    }));
  }

  getRecentCandles(
    exchange: ExchangeName,
    symbol: string,
    type: MarketType,
    interval: CandleInterval,
    count: number = 100,
  ): Candle[] {
    const key = candleKey(exchange, type, symbol, interval);
    const rows = this.db
      .prepare(`
      SELECT open_time, open, high, low, close, volume, closed FROM candles
      WHERE key = ?
      ORDER BY open_time DESC
      LIMIT ?
    `)
      .all(key, count) as Array<{
      open_time: number;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
      closed: number;
    }>;

    return rows.reverse().map((row) => ({
      openTime: row.open_time,
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      volume: row.volume,
      closed: row.closed === 1,
    }));
  }

  // -----------------------------------------------------------------------
  // Trade Operations
  // -----------------------------------------------------------------------

  storeTrade(trade: TradeEvent): void {
    this.db
      .prepare(`
      INSERT INTO trades (exchange, symbol, type, price, quantity, buyer_maker, time_stamp)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
      .run(
        trade.exchange,
        trade.symbol,
        trade.type,
        trade.price,
        trade.quantity,
        trade.buyerMaker ? 1 : 0,
        trade.timeStamp,
      );

    this.enforceRowLimit("trades");
  }

  storeTrades(trades: TradeEvent[]): void {
    const stmt = this.db.prepare(`
      INSERT INTO trades (exchange, symbol, type, price, quantity, buyer_maker, time_stamp)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    for (const trade of trades) {
      stmt.run(
        trade.exchange,
        trade.symbol,
        trade.type,
        trade.price,
        trade.quantity,
        trade.buyerMaker ? 1 : 0,
        trade.timeStamp,
      );
    }

    this.enforceRowLimit("trades");
  }

  getTrades(
    exchange: ExchangeName,
    symbol: string,
    type: MarketType,
    startTime?: number,
    endTime?: number,
    limit: number = 1000,
  ): TradeEvent[] {
    let query = `SELECT exchange, symbol, type, price, quantity, buyer_maker, time_stamp FROM trades WHERE exchange = ? AND symbol = ? AND type = ?`;
    const params: (string | number)[] = [exchange, symbol, type];

    if (startTime) {
      query += " AND time_stamp >= ?";
      params.push(startTime);
    }
    if (endTime) {
      query += " AND time_stamp <= ?";
      params.push(endTime);
    }

    query += " ORDER BY time_stamp DESC LIMIT ?";
    params.push(limit);

    const rows = this.db.prepare(query).all(...params) as Array<{
      exchange: string;
      symbol: string;
      type: string;
      price: number;
      quantity: number;
      buyer_maker: number;
      time_stamp: number;
    }>;

    return rows.map((row) => ({
      exchange: row.exchange as ExchangeName,
      symbol: row.symbol,
      type: row.type as MarketType,
      price: row.price,
      quantity: row.quantity,
      buyerMaker: row.buyer_maker === 1,
      timeStamp: row.time_stamp,
    }));
  }

  // -----------------------------------------------------------------------
  // Order Book Operations
  // -----------------------------------------------------------------------

  storeOrderBook(snapshot: OrderBookSnapshot): void {
    const key = orderBookKey(snapshot.exchange, snapshot.type, snapshot.symbol);
    this.db
      .prepare(`
      INSERT INTO order_books (key, exchange, symbol, type, best_bid, best_bid_qty, best_ask, best_ask_qty, mid_price, bids_json, asks_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
      .run(
        key,
        snapshot.exchange,
        snapshot.symbol,
        snapshot.type,
        snapshot.bestBid ?? null,
        snapshot.bestBidQty ?? null,
        snapshot.bestAsk ?? null,
        snapshot.bestAskQty ?? null,
        snapshot.midPrice ?? null,
        JSON.stringify(snapshot.bids),
        JSON.stringify(snapshot.asks),
        snapshot.updatedAt,
      );

    this.enforceRowLimit("order_books");
  }

  getOrderBook(
    exchange: ExchangeName,
    symbol: string,
    type: MarketType,
    atTime?: number,
  ): OrderBookSnapshot | null {
    const key = orderBookKey(exchange, type, symbol);
    let query = `SELECT * FROM order_books WHERE key = ?`;
    const params: (string | number)[] = [key];

    if (atTime) {
      query += " AND updated_at <= ?";
      params.push(atTime);
    }

    query += " ORDER BY updated_at DESC LIMIT 1";

    const row = this.db.prepare(query).get(...params) as
      | {
          id: number;
          key: string;
          exchange: string;
          symbol: string;
          type: string;
          best_bid: number | null;
          best_bid_qty: number | null;
          best_ask: number | null;
          best_ask_qty: number | null;
          mid_price: number | null;
          bids_json: string;
          asks_json: string;
          updated_at: number;
        }
      | undefined;

    if (!row) return null;

    return {
      exchange: row.exchange as ExchangeName,
      symbol: row.symbol,
      type: row.type as MarketType,
      bestBid: row.best_bid,
      bestBidQty: row.best_bid_qty,
      bestAsk: row.best_ask,
      bestAskQty: row.best_ask_qty,
      midPrice: row.mid_price,
      bids: JSON.parse(row.bids_json || "[]"),
      asks: JSON.parse(row.asks_json || "[]"),
      updatedAt: row.updated_at,
    };
  }

  // -----------------------------------------------------------------------
  // Data Retention & Cleanup
  // -----------------------------------------------------------------------

  /** Delete rows older than the retention window and enforce row limits. */
  cleanupOldData(): void {
    const retentionMs = this.config.maxRetentionDays * 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - retentionMs;

    this.db.exec(
      `
      DELETE FROM candles WHERE open_time < ${cutoff};
      DELETE FROM trades WHERE time_stamp < ${cutoff};
      DELETE FROM order_books WHERE updated_at < ${cutoff};
    `,
    );
  }

  private enforceRowLimit(table: string): void {
    const count = this.db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as {
      count: number;
    };

    if (count.count > this.config.maxRowsPerTable) {
      const excess = count.count - this.config.maxRowsPerTable;
      this.db
        .prepare(`
        DELETE FROM ${table} WHERE id IN (
          SELECT id FROM ${table} ORDER BY stored_at ASC LIMIT ?
        )
      `)
        .run(Math.floor(excess));
    }
  }
  getStats(): Promise<{ candles: number; trades: number; orderBooks: number; dbSize: string }> {
    const [{ count: candleCount }, { count: tradeCount }, { count: obCount }] = [
      this.db.prepare("SELECT COUNT(*) as count FROM candles").get() as { count: number },
      this.db.prepare("SELECT COUNT(*) as count FROM trades").get() as { count: number },
      this.db.prepare("SELECT COUNT(*) as count FROM order_books").get() as { count: number },
    ];

    // Get database file size
    let dbSizeStr = "0 B";
    try {
      const dbPath = this.config.dbPath;
      const stats = statSync(dbPath);
      const size = stats.size;

      // Also count WAL and SHM files
      const walSize = existsSync(dbPath + "-wal") ? statSync(dbPath + "-wal").size : 0;
      const shmSize = existsSync(dbPath + "-shm") ? statSync(dbPath + "-shm").size : 0;

      dbSizeStr = formatBytes(size + walSize + shmSize);
    } catch {
      // never happen
    }

    return Promise.resolve({
      candles: candleCount,
      trades: tradeCount,
      orderBooks: obCount,
      dbSize: dbSizeStr,
    });
  }

  close(): void {
    this.db.close();
  }

  vacuum(): void {
    this.db.exec("VACUUM");
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

// Singleton instance
let dbInstance: HistoricalDatabase | null = null;

export function getDatabase(config?: StorageConfig): HistoricalDatabase {
  if (!dbInstance) {
    dbInstance = new HistoricalDatabase(config);
  }
  return dbInstance;
}

export function closeDatabase(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}
