/**
 * Storage Module (Module 8 - Historical Storage, Replay & Alert Testing)
 *
 * Exports:
 * - HistoricalDatabase: SQLite database for storing candles, trades, order books
 * - ReplayEngine: Replay historical events at configurable speed
 * - testRuleAgainstHistory: Test a single rule against historical data
 * - compareRuleVersions: Compare two versions of rules against same history
 */

export { HistoricalDatabase, getDatabase, closeDatabase, type StorageConfig } from "./database";
export type { ReplayConfig, ReplayStats, ReplayTestResult } from "./replay";
export { ReplayEngine, testRuleAgainstHistory, compareRuleVersions } from "./replay";
