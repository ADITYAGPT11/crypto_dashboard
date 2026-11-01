import type { CanonicalSymbol } from "../types/marketData";

// Parse OKX symbol (e.g., BTC-USDT)
export function parseOkxSymbol(symbol: string): CanonicalSymbol {
  const [base, quote] = symbol.split("-");
  return { base, quote };
}

// Format canonical symbol to string (e.g., BTC-USDT)
export function formatCanonicalSymbol({ base, quote }: CanonicalSymbol): string {
  return `${base}-${quote}`;
}
