import type { CanonicalSymbol } from '../types/marketData';

// List of known quote assets for parsing
const KNOWN_QUOTES = ['USDT', 'BTC', 'ETH', 'BUSD', 'USD', 'EUR', 'TRY', 'BNB'];

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
  const [base, quote] = symbol.split('-');
  return { base, quote };
}

// Format canonical symbol to string (e.g., BTC-USDT)
export function formatCanonicalSymbol({ base, quote }: CanonicalSymbol): string {
  return `${base}-${quote}`;
}
