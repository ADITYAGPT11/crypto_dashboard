import type { Candle, CandleData, CandleInterval } from "../types/marketData";
import { CANDLE_INTERVALS } from "../types/marketData";

/** Interval length in milliseconds; used to detect new bars and merges. */
export const INTERVAL_TO_MS: Record<CandleInterval, number> = {
  "1m": 60_000,
  "3m": 180_000,
  "5m": 300_000,
  "15m": 900_000,
  "30m": 1_800_000,
  "1h": 3_600_000,
  "2h": 7_200_000,
  "4h": 14_400_000,
  "6h": 21_600_000,
  "8h": 28_800_000,
  "12h": 43_200_000,
  "1d": 86_400_000,
  "3d": 259_200_000,
  "1w": 604_800_000,
};

/**
 * Parse an arbitrary interval string into our canonical interval union
 * (e.g. OKX's "1H"/"4H"/"1D" or Binance's "1h"/"4h"/"1d" both normalize).
 * Returns null for unknown intervals so callers can skip them safely.
 */
export function toCanonicalInterval(raw: string): CandleInterval | null {
  const norm = raw.toLowerCase();
  return (CANDLE_INTERVALS as readonly string[]).includes(norm) ? (norm as CandleInterval) : null;
}

/** Guard: at least a few full candles should exist before indicators run. */
export const MIN_CANDLES_FOR_INDICATORS = 5;

/** Sane cap for a client-side candle buffer (deep-history pages included). */
export const MAX_CANDLE_BUFFER = 5000;

/**
 * Validate/coerce one raw candle object (from REST JSON or WS messages) into
 * a Candle, or null when fields are missing/not numbers. Non-throwing so one
 * malformed row never breaks a whole history backfill.
 */
export function toCandle(value: unknown): Candle | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const openTime = v.openTime;
  const nums = [v.open, v.high, v.low, v.close];
  if (typeof openTime !== "number" || !Number.isFinite(openTime)) return null;
  if (!nums.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  const [open, high, low, close] = nums as number[];
  // Basic OHLC sanity: high >= low and close/open within [low, high]
  if (high < low) return null;
  if (Math.max(open, close) > high * (1 + 1e-9) || Math.min(open, close) < low * (1 - 1e-9)) {
    return null;
  }
  const volume =
    typeof v.volume === "number" && Number.isFinite(v.volume) && v.volume >= 0 ? v.volume : 0;
  return {
    openTime,
    open,
    high,
    low,
    close,
    volume,
    closed: typeof v.closed === "boolean" ? v.closed : undefined,
  };
}

/**
 * Merge a live candle update into an ascending, gap-tolerant buffer:
 * - same openTime as an existing candle → replace in place
 * - newer openTime → append (and trim to MAX_CANDLE_BUFFER)
 * - older openTime → ignored (already have history)
 * Mutates and returns the same array instance (cheap setState-style updates).
 */
export function mergeCandle(buffer: Candle[], update: CandleData): Candle[] {
  const candle = { ...update.candle };
  const intervalMs = INTERVAL_TO_MS[update.interval];

  const last = buffer[buffer.length - 1];
  if (last && candle.openTime === last.openTime) {
    buffer[buffer.length - 1] = candle;
    return buffer;
  }
  if (last && candle.openTime < last.openTime - intervalMs / 2) {
    return buffer; // stale/out-of-order update; history already present
  }
  // replays of the tail (same or newer existing bar above last) are rare here;
  // linear scan keeps the buffer ascending.
  for (let i = buffer.length - 1; i >= 0 && buffer[i].openTime > candle.openTime; i--) {
    if (buffer[i].openTime === candle.openTime) {
      buffer[i] = candle;
      return buffer;
    }
  }
  buffer.push(candle);
  if (buffer.length > MAX_CANDLE_BUFFER) {
    buffer.splice(0, buffer.length - MAX_CANDLE_BUFFER);
  }
  return buffer;
}

/**
 * Prepend older REST candles (ascending) to the head of an ascending buffer:
 * - rows at-or-newer than the buffer head are skipped (overlap dedupe)
 * - any newer/equal row inside the batch is skipped (batch dedupe)
 * - the buffer is trimmed from the head to MAX_CANDLE_BUFFER
 * Mutates and returns the number of rows actually added.
 */
export function prependCandles(buffer: Candle[], olderAsc: Candle[]): number {
  const head = buffer[0];
  let added = 0;
  // Iterate the older batch newest-first so dedupe against buffer[0]
  // covers rows inserted from the same batch.
  for (let i = olderAsc.length - 1; i >= 0; i--) {
    const c = olderAsc[i];
    if (!Number.isFinite(c?.openTime)) continue;
    if (head && c.openTime >= head.openTime) continue;
    if (buffer.length > 0 && c.openTime >= buffer[0].openTime) continue;
    buffer.unshift(c);
    added++;
  }
  if (buffer.length > MAX_CANDLE_BUFFER) {
    buffer.splice(0, buffer.length - MAX_CANDLE_BUFFER);
  }
  return added;
}

/** Sort REST-returned candles ascending by openTime and drop malformed rows. */
export function normalizeHistory(candles: unknown[]): Candle[] {
  const parsed = candles
    .map((c) => toCandle(c))
    .filter((c): c is Candle => c !== null)
    .sort((a, b) => a.openTime - b.openTime);
  // dedupe by openTime (keep the last occurrence)
  const result: Candle[] = [];
  for (const c of parsed) {
    if (result.length > 0 && result[result.length - 1].openTime === c.openTime) {
      result[result.length - 1] = c;
    } else {
      result.push(c);
    }
  }
  return result;
}
