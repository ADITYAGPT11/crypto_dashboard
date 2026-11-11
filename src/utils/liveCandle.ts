import type { Candle } from "../types/marketData";

export type LiveSource = "BINANCE" | "OKX";

/** A source counts as live while its last tick is at most this old. */
export const LIVE_STALE_MS = 15_000;

/**
 * Binance's forming candle while it ticks (the chart's history is Binance's), else OKX's,
 * else the freshest one seen. Null until anything has arrived.
 */
export function pickLive(
  last: Record<LiveSource, { candle: Candle; at: number } | null>,
  now: number,
): { candle: Candle; source: LiveSource; at: number } | null {
  const fresh = (s: LiveSource) => {
    const l = last[s];
    return l !== null && now - l.at <= LIVE_STALE_MS;
  };
  const order: LiveSource[] = fresh("BINANCE")
    ? ["BINANCE"]
    : fresh("OKX")
      ? ["OKX"]
      : (["BINANCE", "OKX"] as LiveSource[]).sort(
          (a, b) => (last[b]?.at ?? 0) - (last[a]?.at ?? 0),
        );
  for (const s of order) {
    const l = last[s];
    if (l) return { candle: l.candle, source: s, at: l.at };
  }
  return null;
}
