/**
 * Backend Service (Module 7+)
 *
 * Node.js backend for:
 * - Telegram bot token storage and management
 * - Alert delivery via Telegram Bot API
 * - Historical data persistence (SQLite - Module 8)
 * - Historical replay and alert testing (Module 8)
 *
 * This is a lightweight Express server that provides:
 * - REST API for configuration (bot token, chat IDs)
 * - REST API for historical data storage and retrieval
 * - REST API for replay and alert testing
 */

import express, { type Request, type Response } from "express";
import { telegramService } from "./telegramService";
import { closeDatabase, getDatabase, type StorageConfig } from "./storage/database";
import { ReplayEngine, testRuleAgainstHistory, compareRuleVersions } from "./storage/replay";
import type { AlertTrigger, AlertRule } from "../types/alertRules";
import type { Candle, TradeEvent } from "../types/marketData";
import type { ExchangeName, MarketType, CandleInterval } from "../types/marketData";

const PORT = Number(process.env.PORT ?? 3001);

const app = express();
app.use(express.json());

// Initialize database on startup
const dbConfig: StorageConfig = {
  dbPath: process.env.DB_PATH ?? "./data/history.db",
  maxRetentionDays: Number(process.env.DB_RETENTION_DAYS ?? 30),
  maxRowsPerTable: Number(process.env.DB_MAX_ROWS ?? 1000000),
};

// Ensure data directory exists
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = `${__dirname}/data`;

try {
  await mkdir(dataDir, { recursive: true });
} catch {
  // Directory may already exist
}
const db = getDatabase(dbConfig);

// Health check
app.get("/health", async (_req: Request, res: Response) => {
  try {
    const stats = await db.getStats();
    res.json({
      status: "ok",
      timestamp: Date.now(),
      telegram: telegramService.getStatus(),
      storage: stats,
    });
  } catch (error) {
    res.status(500).json({ status: "error", error: String(error) });
  }
});

// -----------------------------------------------------------------------
// Telegram Configuration Endpoints
// -----------------------------------------------------------------------

app.post("/telegram/config", (req: Request, res: Response) => {
  const { botToken, chatIds } = req.body as {
    botToken?: unknown;
    chatIds?: unknown;
  };

  const _botTokenStr = typeof botToken === "string" ? botToken : "";
  const _chatIdsArr: string[] = Array.isArray(chatIds)
    ? (chatIds as unknown[]).filter((x): x is string => typeof x === "string")
    : typeof chatIds === "string"
      ? [chatIds as string]
      : [];
  if (!_botTokenStr || !_chatIdsArr.length) {
    return res.status(400).json({ error: "botToken and chatIds are required" });
  }

  telegramService.configure({
    botToken: _botTokenStr,
    chatIds: _chatIdsArr,
  });

  res.json({ success: true, status: telegramService.getStatus() });
});

app.get("/telegram/config", (_req: Request, res: Response) => {
  res.json({
    configured: telegramService.isConfigured(),
    chatCount: telegramService.getStatus().chatCount,
  });
});

// -----------------------------------------------------------------------
// Alert Delivery Endpoint
// -----------------------------------------------------------------------

app.post("/alerts/send", async (req: Request, res: Response) => {
  const { trigger, rule } = req.body as {
    trigger?: unknown;
    rule?: unknown;
  };

  if (
    !trigger ||
    !(trigger && "ruleId" in trigger && "ruleName" in trigger && "reason" in trigger)
  ) {
    return res.status(400).json({ error: "Invalid alert trigger" });
  }

  const success = await telegramService.sendAlert(
    trigger as AlertTrigger,
    rule as AlertRule | undefined,
  );
  res.json({ success });
});

// -----------------------------------------------------------------------
// Historical Data Storage Endpoints (Module 8)
// -----------------------------------------------------------------------

// Store candles
app.post("/storage/candles", (req: ExpressRequest, res: ExpressResponse) => {
  try {
    const { candles, exchange, symbol, type, interval } = req.body as {
      candles?: unknown;
      exchange?: unknown;
      symbol?: unknown;
      type?: unknown;
      interval?: unknown;
    };

    if (!candles || !Array.isArray(candles)) {
      return res.status(400).json({ error: "candles array required" });
    }

    for (const candle of candles) {
      db.storeCandle(
        candle as Candle,
        exchange as ExchangeName,
        String(symbol),
        type as MarketType,
        interval as CandleInterval,
      );
    }

    res.json({ stored: candles.length });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Get candles
app.get("/storage/candles", (req: ExpressRequest, res: ExpressResponse) => {
  try {
    const { exchange, symbol, type, interval, startTime, endTime, limit } = req.query as {
      exchange?: string;
      symbol?: string;
      type?: string;
      interval?: string;
      startTime?: string;
      endTime?: string;
      limit?: string;
    };

    if (!exchange || !symbol || !type || !interval) {
      return res.status(400).json({ error: "exchange, symbol, type, interval required" });
    }

    const candles = db.getCandles(
      exchange as ExchangeName,
      symbol,
      type as MarketType,
      interval as CandleInterval,
      startTime ? Number(startTime) : undefined,
      endTime ? Number(endTime) : undefined,
      limit ? Number(limit) : 1000,
    );

    res.json({ candles, count: candles.length });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Store trades
app.post("/storage/trades", (req: ExpressRequest, res: ExpressResponse) => {
  try {
    const { trades } = req.body as {
      trades?: unknown;
    };

    if (!trades || !Array.isArray(trades)) {
      return res.status(400).json({ error: "trades array required" });
    }

    for (const trade of trades) {
      db.storeTrade(trade as TradeEvent);
    }

    res.json({ stored: trades.length });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Get trades
app.get("/storage/trades", (req: ExpressRequest, res: ExpressResponse) => {
  try {
    const { exchange, symbol, type, startTime, endTime, limit } = req.query as {
      exchange?: string;
      symbol?: string;
      type?: string;
      startTime?: string;
      endTime?: string;
      limit?: string;
    };

    if (!exchange || !symbol || !type) {
      return res.status(400).json({ error: "exchange, symbol, type required" });
    }

    const trades = db.getTrades(
      exchange as ExchangeName,
      symbol,
      type as MarketType,
      startTime ? Number(startTime) : undefined,
      endTime ? Number(endTime) : undefined,
      limit ? Number(limit) : 1000,
    );

    res.json({ trades, count: trades.length });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Store order book snapshot
app.post("/storage/orderbook", (req: ExpressRequest, res: ExpressResponse) => {
  try {
    const { snapshot } = req.body as {
      snapshot?: unknown;
    };

    if (!snapshot) {
      return res.status(400).json({ error: "snapshot required" });
    }

    db.storeOrderBook(snapshot as Parameters<typeof db.storeOrderBook>[0]);
    res.json({ stored: 1 });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Get order book snapshot
app.get("/storage/orderbook", (req: ExpressRequest, res: ExpressResponse) => {
  try {
    const { exchange, symbol, type, atTime } = req.query as {
      exchange?: string;
      symbol?: string;
      type?: string;
      atTime?: string;
    };

    if (!exchange || !symbol || !type) {
      return res.status(400).json({ error: "exchange, symbol, type required" });
    }

    const snapshot = db.getOrderBook(
      exchange as "BINANCE" | "OKX" | "DELTA",
      symbol,
      type as "SPOT" | "FUT",
      atTime ? Number(atTime) : undefined,
    );

    res.json({ snapshot });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Get storage stats
app.get("/storage/stats", async (_req: Request, res: Response) => {
  try {
    const stats = await db.getStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// -----------------------------------------------------------------------
// Replay & Alert Testing Endpoints (Module 8)
// -----------------------------------------------------------------------

// Start replay
app.post("/replay/start", async (req: ExpressRequest, res: ExpressResponse) => {
  try {
    const { speed, symbols, startDate, endDate, rules, onTrigger } = req.body as {
      speed?: unknown;
      symbols?: unknown;
      startDate?: unknown;
      endDate?: unknown;
      rules?: unknown;
      onTrigger?: unknown;
    };

    if (!speed || !symbols?.length) {
      return res.status(400).json({ error: "speed and symbols required" });
    }
    const _speed = Number(speed);
    const _symbols = (Array.isArray(symbols) ? symbols : [symbols]).map((x) => String(x));
    const _startDate = startDate ? Number(startDate) : undefined;
    const _endDate = endDate ? Number(endDate) : undefined;

    const replay = new ReplayEngine({
      speed: _speed,
      symbols: _symbols,
      startDate: _startDate,
      endDate: _endDate,
      rules: rules as AlertRule[] | undefined,
      onTrigger: onTrigger as ((trigger: AlertTrigger) => void) | undefined,
      onProgress: (progress) => {
        console.log(`[Replay] Progress: ${progress.toFixed(1)}%`);
      },
    });

    const stats = await replay.start();

    res.json({
      success: true,
      stats,
      message: `Replayed ${stats.totalCandles} candles, ${stats.totalTriggers} triggers in ${stats.durationMs}ms`,
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Stop replay
app.post("/replay/stop", (_req: ExpressRequest, res: ExpressResponse) => {
  // ReplayEngine is ephemeral - this is more for future webhook support
  res.json({ stopped: true });
});

// Test rule against history
app.post("/test/rule", (req: ExpressRequest, res: ExpressResponse) => {
  try {
    const { rule, candles, trades } = req.body as {
      rule?: unknown;
      candles?: unknown;
      trades?: unknown;
    };

    if (!rule || !candles?.length) {
      return res.status(400).json({ error: "rule and candles required" });
    }

    const result = testRuleAgainstHistory(
      rule as AlertRule,
      candles as Candle[],
      (trades as TradeEvent[]) ?? [],
    );

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Compare rule versions
app.post("/test/compare", (req: ExpressRequest, res: ExpressResponse) => {
  try {
    const { oldRules, newRules, candles, trades } = req.body as {
      oldRules?: unknown;
      newRules?: unknown;
      candles?: unknown;
      trades?: unknown;
    };

    if (!oldRules || !newRules || !candles?.length) {
      return res.status(400).json({ error: "oldRules, newRules, and candles required" });
    }

    const result = compareRuleVersions(
      oldRules as AlertRule[],
      newRules as AlertRule[],
      candles as Candle[],
      (trades as TradeEvent[]) ?? [],
    );

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// -----------------------------------------------------------------------
// Database Maintenance
// -----------------------------------------------------------------------

app.post("/storage/vacuum", (_req: ExpressRequest, res: ExpressResponse) => {
  try {
    db.vacuum();
    res.json({ success: true, message: "Database vacuumed" });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.post("/storage/cleanup", (_req: ExpressRequest, res: ExpressResponse) => {
  try {
    // Force cleanup
    db.cleanupOldData();
    res.json({ success: true, message: "Old data cleaned up" });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// -----------------------------------------------------------------------
// Start server
// -----------------------------------------------------------------------

const server = app.listen(PORT, () => {
  console.log(`[Backend] Server running on port ${PORT}`);
  console.log(`[Backend] Health check: http://localhost:${PORT}/health`);
  console.log(`[Backend] Storage: ${dbConfig.dbPath}`);
  console.log(`[Backend] Retention: ${dbConfig.maxRetentionDays} days`);
});

app.use((err: unknown, _req: Request, res: Response, _next: unknown) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("[Backend] SIGTERM received, shutting down...");
  closeDatabase();
  server.close(() => {
    console.log("[Backend] Server closed");
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  console.log("[Backend] SIGINT received, shutting down...");
  closeDatabase();
  server.close(() => {
    console.log("[Backend] Server closed");
    process.exit(0);
  });
});

export { telegramService, app, db };
