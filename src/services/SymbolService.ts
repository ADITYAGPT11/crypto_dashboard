/**
 * Service to fetch real-time symbol data from exchanges
 */
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
      const response = await fetch('https://api.binance.com/api/v3/exchangeInfo');
      const data = await response.json();
      
      this.binanceSymbols = data.symbols
        .filter((symbol: any) => 
          symbol.status === 'TRADING' && 
          symbol.symbol.endsWith('USDT') &&
          !symbol.symbol.includes('UP') &&
          !symbol.symbol.includes('DOWN') &&
          !symbol.symbol.includes('BEAR') &&
          !symbol.symbol.includes('BULL')
        )
        .map((symbol: any) => symbol.symbol.replace('USDT', ''))
        .sort();
      
      this.updateAllSymbols();
      return this.binanceSymbols;
    } catch (error) {
      console.error('Error fetching Binance symbols:', error);
      return [];
    }
  }

  async fetchOKXSymbols(): Promise<string[]> {
    try {
      const response = await fetch('https://www.okx.com/api/v5/public/instruments?instType=SPOT');
      const data = await response.json();
      
      this.okxSymbols = data.data
        .filter((instrument: any) => 
          instrument.state === 'live' && 
          instrument.quoteCcy === 'USDT' &&
          !instrument.instId.includes('UP') &&
          !instrument.instId.includes('DOWN')
        )
        .map((instrument: any) => instrument.baseCcy)
        .sort();
      
      this.updateAllSymbols();
      return this.okxSymbols;
    } catch (error) {
      console.error('Error fetching OKX symbols:', error);
      return [];
    }
  }

  async fetchAllSymbols(): Promise<string[]> {
    try {
      await Promise.all([
        this.fetchBinanceSymbols(),
        this.fetchOKXSymbols()
      ]);
      return this.allSymbols;
    } catch (error) {
      console.error('Error fetching all symbols:', error);
      return [];
    }
  }

  private updateAllSymbols() {
    const combined = [...new Set([...this.binanceSymbols, ...this.okxSymbols])];
    this.allSymbols = combined.sort();
  }

  getPopularSymbols(): string[] {
    return [
      'BTC', 'ETH', 'BNB', 'ADA', 'SOL', 'XRP', 'DOT', 'AVAX', 
      'MATIC', 'LINK', 'UNI', 'LTC', 'ATOM', 'NEAR', 'FTM',
      'ALGO', 'VET', 'ICP', 'FIL', 'TRX', 'ETC', 'XLM', 'HBAR',
      'DOGE', 'SHIB', 'PEPE', 'WIF', 'BONK', 'FLOKI'
    ];
  }

  searchSymbols(query: string): string[] {
    const searchTerm = query.toLowerCase();
    return this.allSymbols.filter(symbol => 
      symbol.toLowerCase().includes(searchTerm)
    ).slice(0, 20); // Limit to 20 results
  }

  getAllSymbols(): string[] {
    return this.allSymbols;
  }
}
