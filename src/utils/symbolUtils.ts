/**
 * Symbol normalization utilities for different exchanges
 */

export function normalizeSymbol(symbol: string): string {
  // Remove common suffixes and prefixes
  return symbol
    .replace(/-USDT$/i, '')  // Remove -USDT suffix (OKX)
    .replace(/USDT$/i, '')   // Remove USDT suffix (Binance)
    .replace(/-SWAP$/i, '')  // Remove -SWAP suffix (OKX futures)
    .toUpperCase();
}

export function createSymbolKey(exchange: string, symbol: string, type: string): string {
  const normalizedSymbol = normalizeSymbol(symbol);
  return `${exchange}-${normalizedSymbol}-${type}`;
}

export function extractBaseSymbol(symbol: string): string {
  return normalizeSymbol(symbol);
}
