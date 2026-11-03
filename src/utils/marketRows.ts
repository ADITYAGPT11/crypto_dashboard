/**
 * Joins exchange snapshots (24h ticker, funding, open interest) with statistics
 * computed from closed candles into one row per coin for the Dashboard.
 */
import type { Candle } from "../types/marketData";
import type { FuturesTicker } from "./marketOverview";
import { aboveEma, atrPct, changePct, realizedVol } from "./marketStats";

const H4 = 14_400_000;
const DAY = 86_400_000;

export interface CoinRow {
  symbol: string;
  base: string;
  price: number;
  /** 24h change from the exchange ticker, else from candles. */
  change24h: number;
  change7d: number;
  quoteVolume: number;
  vol7d: number;
  atr4h: number;
  trend4h: boolean | null;
  trend1d: boolean | null;
  fundingPct: number | null;
  oiChange24h: number | null;
  corrBtc: number | null;
}

/** Last close of each UTC day from intraday candles (ascending). */
export function dailyCloses(candles: readonly Candle[]): number[] {
  const out: number[] = [];
  let day = Number.NaN;
  for (const c of candles) {
    const d = Math.floor(c.openTime / DAY);
    if (d === day) out[out.length - 1] = c.close;
    else {
      out.push(c.close);
      day = d;
    }
  }
  // drop the current, unfinished day
  const last = candles[candles.length - 1];
  if (last && (last.openTime + H4) % DAY !== 0) out.pop();
  return out;
}

export function buildCoinRows(input: {
  symbols: readonly string[];
  candles: ReadonlyMap<string, readonly Candle[]>;
  tickers: readonly FuturesTicker[];
  funding: ReadonlyMap<string, { fundingPct: number }>;
  openInterest: ReadonlyMap<string, number>;
  corrBtc: ReadonlyMap<string, number>;
}): CoinRow[] {
  const tick = new Map(input.tickers.map((t) => [t.symbol, t]));
  return input.symbols.flatMap((symbol) => {
    const c = input.candles.get(symbol) ?? [];
    const closes = c.map((x) => x.close);
    const t = tick.get(symbol);
    const price = t?.price ?? closes[closes.length - 1];
    if (price == null || !Number.isFinite(price)) return [];
    return [
      {
        symbol,
        base: symbol.split("-")[0],
        price,
        change24h: t?.changePct ?? changePct(closes, 6),
        change7d: changePct(closes, 42),
        quoteVolume: t?.quoteVolume ?? Number.NaN,
        vol7d: realizedVol(closes, 42, H4),
        atr4h: atrPct(c),
        trend4h: aboveEma(closes, 50),
        trend1d: aboveEma(dailyCloses(c), 50),
        fundingPct: input.funding.get(symbol)?.fundingPct ?? null,
        oiChange24h: input.openInterest.get(symbol) ?? null,
        corrBtc: input.corrBtc.get(symbol) ?? null,
      },
    ];
  });
}

/** Mean of the finite values, or null. */
export function meanOf(values: readonly (number | null | undefined)[]): number | null {
  const v = values.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
}
