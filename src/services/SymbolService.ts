import { toCanonicalSymbols } from "../utils/symbolUtils";

/**
 * Service to fetch real-time symbol data from exchanges
 */
interface BinanceSymbol {
  status: string;
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
}

interface OkxInstrument {
  state: string;
  quoteCcy: string;
  instId: string;
  baseCcy: string;
}

const FETCH_TIMEOUT_MS = 10_000;

export class SymbolService {
  private static instance: SymbolService | null = null;
  private binanceSymbols: string[] = [];
  private okxSymbols: string[] = [];
  private allSymbols: string[] = [];

  private constructor() {}

  static getInstance(): SymbolService {
    if (!SymbolService.instance) {
      SymbolService.instance = new SymbolService();
    }
    return SymbolService.instance;
  }

  async fetchBinanceSymbols(): Promise<string[]> {
    try {
      const response = await fetch("https://api.binance.com/api/v3/exchangeInfo", {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(`Binance exchangeInfo HTTP ${response.status}`);
      }
      const data = await response.json();

      const symbols: BinanceSymbol[] = data.symbols;
      const bases = symbols
        .filter((symbol) => symbol.status === "TRADING" && symbol.quoteAsset === "USDT")
        .map((symbol) => symbol.baseAsset);
      this.binanceSymbols = toCanonicalSymbols(bases, "USDT");

      this.updateAllSymbols();
      return this.binanceSymbols;
    } catch (error) {
      console.error("Error fetching Binance symbols:", error);
      return [];
    }
  }

  async fetchOKXSymbols(): Promise<string[]> {
    try {
      const response = await fetch("https://www.okx.com/api/v5/public/instruments?instType=SPOT", {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(`OKX instruments HTTP ${response.status}`);
      }
      const data = await response.json();

      const instruments: OkxInstrument[] = data.data;
      const bases = instruments
        .filter((instrument) => instrument.state === "live" && instrument.quoteCcy === "USDT")
        .map((instrument) => instrument.baseCcy);
      this.okxSymbols = toCanonicalSymbols(bases, "USDT");

      this.updateAllSymbols();
      return this.okxSymbols;
    } catch (error) {
      console.error("Error fetching OKX symbols:", error);
      return [];
    }
  }

  async fetchAllSymbols(): Promise<string[]> {
    try {
      await Promise.all([this.fetchBinanceSymbols(), this.fetchOKXSymbols()]);
      return this.allSymbols;
    } catch (error) {
      console.error("Error fetching all symbols:", error);
      return [];
    }
  }

  private updateAllSymbols() {
    const combined = [...new Set([...this.binanceSymbols, ...this.okxSymbols])];
    this.allSymbols = combined.sort();
  }

  getPopularSymbols(): string[] {
    return [
      "BTC-USDT",
      "ETH-USDT",
      "BNB-USDT",
      "ADA-USDT",
      "SOL-USDT",
      "XRP-USDT",
      "DOT-USDT",
      "AVAX-USDT",
      "POL-USDT",
      "LINK-USDT",
      "UNI-USDT",
      "LTC-USDT",
      "ATOM-USDT",
      "NEAR-USDT",
      "S-USDT",
      "ALGO-USDT",
      "VET-USDT",
      "ICP-USDT",
      "FIL-USDT",
      "TRX-USDT",
      "ETC-USDT",
      "XLM-USDT",
      "HBAR-USDT",
      "DOGE-USDT",
      "SHIB-USDT",
      "PEPE-USDT",
      "WIF-USDT",
      "BONK-USDT",
      "FLOKI-USDT",
    ];
  }

  searchSymbols(query: string): string[] {
    const searchTerm = query.toLowerCase();
    return this.allSymbols
      .filter((symbol) => symbol.toLowerCase().includes(searchTerm))
      .slice(0, 20); // Limit to 20 results
  }

  /** Exchanges whose spot list includes the symbol (empty until lists are fetched). */
  listedOn(symbol: string): { binance: boolean; okx: boolean } {
    return { binance: this.binanceSymbols.includes(symbol), okx: this.okxSymbols.includes(symbol) };
  }

  getAllSymbols(): string[] {
    return this.allSymbols;
  }
}
