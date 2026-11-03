/**
 * Parsers for the free, keyless market-overview sources. Each takes the raw JSON
 * and returns clean values or null, so a changed or failed response degrades to
 * "unavailable" instead of wrong numbers.
 *
 * Sources: Binance USDⓈ-M public REST + liquidation stream, alternative.me
 * Fear & Greed Index, CoinGecko /global (BTC dominance).
 */

function num(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : Number.NaN;
  return Number.isFinite(n) ? n : Number.NaN;
}

function rows(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v)
    ? v.filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null)
    : [];
}

/** BTC-USDT ↔ BTCUSDT */
export function toWire(symbol: string): string {
  return symbol.replace("-", "");
}

export interface FuturesTicker {
  symbol: string;
  price: number;
  changePct: number;
  quoteVolume: number;
}

/** /fapi/v1/ticker/24hr (all symbols) → the requested canonical symbols. */
export function parseFuturesTickers(raw: unknown, symbols: readonly string[]): FuturesTicker[] {
  const byWire = new Map(rows(raw).map((r) => [String(r.symbol), r]));
  return symbols.flatMap((symbol) => {
    const r = byWire.get(toWire(symbol));
    if (!r) return [];
    const t = {
      symbol,
      price: num(r.lastPrice),
      changePct: num(r.priceChangePercent),
      quoteVolume: num(r.quoteVolume),
    };
    return Number.isFinite(t.price) ? [t] : [];
  });
}

/** /fapi/v1/premiumIndex (all symbols) → funding rate in percent per symbol. */
export function parsePremiumIndex(
  raw: unknown,
  symbols: readonly string[],
): Map<string, { fundingPct: number; nextFundingTime: number }> {
  const byWire = new Map(rows(raw).map((r) => [String(r.symbol), r]));
  const out = new Map<string, { fundingPct: number; nextFundingTime: number }>();
  for (const s of symbols) {
    const r = byWire.get(toWire(s));
    const rate = num(r?.lastFundingRate);
    if (Number.isFinite(rate))
      out.set(s, { fundingPct: rate * 100, nextFundingTime: num(r?.nextFundingTime) });
  }
  return out;
}

/** /futures/data/openInterestHist (ascending) → % change first → last value (USD). */
export function parseOpenInterestChange(raw: unknown): number | null {
  const values = rows(raw)
    .map((r) => num(r.sumOpenInterestValue))
    .filter(Number.isFinite);
  if (values.length < 2 || values[0] <= 0) return null;
  return ((values[values.length - 1] - values[0]) / values[0]) * 100;
}

/** /futures/data/globalLongShortAccountRatio → latest long/short account ratio. */
export function parseLongShortRatio(raw: unknown): number | null {
  const list = rows(raw);
  const v = num(list[list.length - 1]?.longShortRatio);
  return Number.isFinite(v) ? v : null;
}

export interface FearGreed {
  value: number;
  label: string;
  /** Epoch ms of the reading. */
  time: number;
  yesterday: number | null;
  lastWeek: number | null;
}

/** api.alternative.me/fng/?limit=8 → today, yesterday and a week ago (newest first). */
export function parseFearGreed(raw: unknown): FearGreed | null {
  const data = rows((raw as { data?: unknown } | null)?.data);
  const today = data[0];
  const value = num(today?.value);
  if (!today || !Number.isFinite(value)) return null;
  const at = (i: number) => {
    const v = num(data[i]?.value);
    return Number.isFinite(v) ? v : null;
  };
  return {
    value,
    label: typeof today.value_classification === "string" ? today.value_classification : "",
    time: num(today.timestamp) * 1000,
    yesterday: at(1),
    lastWeek: at(7),
  };
}

/** api.coingecko.com/api/v3/global → BTC share of total crypto market cap, %. */
export function parseBtcDominance(raw: unknown): number | null {
  const data = (raw as { data?: { market_cap_percentage?: { btc?: unknown } } } | null)?.data;
  const v = num(data?.market_cap_percentage?.btc);
  return Number.isFinite(v) ? v : null;
}

export interface Liquidation {
  symbol: string;
  /** "long" = a long position was force-closed (exchange SELL order). */
  side: "long" | "short";
  price: number;
  usd: number;
  time: number;
}

/** Binance `!forceOrder@arr` message → a liquidation in USD, or null. */
export function parseForceOrder(raw: unknown): Liquidation | null {
  const o = (raw as { o?: Record<string, unknown> } | null)?.o;
  if (!o || typeof o.s !== "string" || !o.s.endsWith("USDT")) return null;
  const price = num(o.ap) || num(o.p);
  const qty = num(o.z) || num(o.q);
  const time = num(o.T);
  if (!Number.isFinite(price) || !Number.isFinite(qty) || !Number.isFinite(time)) return null;
  return {
    symbol: `${o.s.slice(0, -4)}-USDT`,
    side: o.S === "SELL" ? "long" : "short",
    price,
    usd: price * qty,
    time,
  };
}

/** Totals over liquidations newer than `since`. */
export function sumLiquidations(list: readonly Liquidation[], since: number) {
  let long = 0;
  let short = 0;
  let largest: Liquidation | null = null;
  for (const l of list) {
    if (l.time < since) continue;
    if (l.side === "long") long += l.usd;
    else short += l.usd;
    if (!largest || l.usd > largest.usd) largest = l;
  }
  return { long, short, largest };
}
