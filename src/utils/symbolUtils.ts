import type { CanonicalSymbol } from "../types/marketData";

// List of known quote assets for parsing
const KNOWN_QUOTES = ["USDT", "BTC", "ETH", "BUSD", "USD", "EUR", "TRY", "BNB"];

// Parse Binance symbol (e.g., BTCUSDT)
export function parseBinanceSymbol(symbol: string): CanonicalSymbol {
  for (const quote of KNOWN_QUOTES) {
    if (symbol.endsWith(quote)) {
      return {
        base: symbol.slice(0, -quote.length),
        quote,
      };
    }
  }
  throw new Error(`Unknown Binance symbol format: ${symbol}`);
}

// Parse OKX symbol (e.g., BTC-USDT)
export function parseOkxSymbol(symbol: string): CanonicalSymbol {
  const [base, quote] = symbol.split("-");
  return { base, quote };
}

// Format canonical symbol to string (e.g., BTC-USDT)
export function formatCanonicalSymbol({ base, quote }: CanonicalSymbol): string {
  return `${base}-${quote}`;
}

/** Suffixes of exchange leveraged tokens (e.g. Binance's retired BTCUP, ETHBULL). */
const LEVERAGED_SUFFIXES = ["UP", "DOWN", "BULL", "BEAR"];

/**
 * True when `base` is a leveraged token: another listed base plus a leveraged suffix
 * (BTCUP = BTC + UP). Real coins that merely contain the letters are kept: JUP's
 * remainder "J" is not a listed base, and SUPER does not end with a suffix.
 */
export function isLeveragedToken(base: string, listedBases: ReadonlySet<string>): boolean {
  return LEVERAGED_SUFFIXES.some((suffix) => {
    if (!base.endsWith(suffix) || base.length === suffix.length) return false;
    return listedBases.has(base.slice(0, -suffix.length));
  });
}

/**
 * Canonical `BASE-QUOTE` symbols for the given bases, leveraged tokens removed,
 * de-duplicated and sorted.
 */
export function toCanonicalSymbols(bases: readonly string[], quote: string): string[] {
  const listed = new Set(bases);
  const kept = [...listed].filter((base) => !isLeveragedToken(base, listed));
  return kept.map((base) => `${base}-${quote}`).sort();
}

/**
 * Quote currency of each exchange's instruments as streamed here. Delta India
 * perpetuals (BTCUSD) are USD-quoted, so their prices are not directly comparable
 * with USDT prices: USDT can trade slightly away from 1 USD.
 */
export function quoteCurrency(exchange: string): "USDT" | "USD" {
  return exchange === "DELTA" ? "USD" : "USDT";
}

/** Exchanges whose funding-rate units have not been checked against their API docs. */
export function fundingUnitsVerified(exchange: string): boolean {
  return exchange !== "DELTA";
}
