import type { 
  OptionChainData, 
  OptionStrike, 
  AngleOneCredentials,
  AngleOneOptionQuote 
} from '../types/optionData';
import { generateTOTP } from '../utils/totp';

// Use proxy in development, direct API in production
// In development, Vite proxy will forward /api/angelone to the proxy server
const USE_PROXY = import.meta.env.VITE_USE_PROXY !== 'false';
const PROXY_BASE = '/api/angelone/rest';
const DIRECT_BASE = 'https://apiconnect.angelone.in/rest';

const getBaseUrl = () => USE_PROXY ? PROXY_BASE : DIRECT_BASE;
const ANGLE_ONE_WS_URL = 'wss://apiconnect.angelone.in/rest/secure/websocket';

interface AngelOneTokenResponse {
  jwtToken: string;
  refreshToken: string;
  status: boolean;
  error?: string;
}

interface AngelOneOrderBookResponse {
  data: {
    symbol: string;
    token: string;
    nseSymbol: string;
    exchange: string;
    lotSize: number;
    expiry: string;
    strike: number;
    optionType: string;
    tickSize: number;
  }[];
  apcode: string;
  chanelAppId: string;
  jwtToken: string;
  msgId: string;
  requestTime: string;
  responseType: string;
  status: boolean;
}

interface AngelOneLTPResponse {
  data: {
    symbol?: string;
    token: string;
    exchange?: string;
    lastPrice?: number;
    close?: number;
    change?: number;
    percentChange?: number;
    high?: number;
    low?: number;
    open?: number;
    highN?: number;
    lowN?: number;
    closed?: boolean;
    lastTradedQuantity?: number;
    lastTradedTime?: number;
    avgTradedPrice?: number;
    volume?: number;
    buyQty?: number;
    sellQty?: number;
    lowerCircuit?: number;
    upperCircuit?: number;
    totBuyQt?: number;
    totSellQty?: number;
    securityVar?: number;
    mVal?: number;
    pVal?: number;
    cfVar?: number;
    atmStrike?: number;
    totalValue?: number;
    syomFlag?: boolean;
    stage?: string;
  }[];
  apcode: string;
  chanelAppId: string;
  jwtToken: string;
  msgId: string;
  requestTime: string;
  responseType: string;
  status: boolean;
}

export class AngleOneService {
  private credentials: AngleOneCredentials | null = null;
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private apiKey: string = '';
  private ws: WebSocket | null = null;
  private subscribers: Map<string, Set<(data: OptionChainData) => void>> = new Map();
  private connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'error' = 'disconnected';
  private lastError: string = '';

  constructor() {
    this.apiKey = import.meta.env.VITE_ANGLEONE_API_KEY || '';
  }

  setCredentials(credentials: AngleOneCredentials): void {
    this.credentials = credentials;
  }

  private getAuthHeaders(): HeadersInit {
    return {
      'Content-Type': 'application/json',
      'X-Api-Key': this.apiKey,
      'Authorization': this.accessToken ? `Bearer ${this.accessToken}` : '',
    };
  }

  async authenticate(clientCode: string, totp: string, password?: string): Promise<{ success: boolean; error?: string }> {
    this.connectionStatus = 'connecting';
    
    if (!this.credentials) {
      this.credentials = { apiKey: this.apiKey, clientCode };
    }

    try {
      const response = await fetch(`${getBaseUrl()}/secure/angelbroking/user/v1/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': this.apiKey,
        },
        body: JSON.stringify({
          clientCode,
          password: password || '',
          totp,
          vendorCode: '',
          source: 'WEB',
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('HTTP Error:', response.status, errorText);
        this.connectionStatus = 'error';
        this.lastError = `HTTP Error ${response.status}: ${errorText}`;
        return { success: false, error: this.lastError };
      }

      const data = await response.json() as AngelOneTokenResponse;
      console.log('Angel One Auth Response:', data);
      
      if (data.status !== undefined && !data.status) {
        this.connectionStatus = 'error';
        this.lastError = 'Authentication failed: Invalid credentials or API error';
        return { success: false, error: this.lastError };
      }
      
      if (data.jwtToken) {
        this.accessToken = data.jwtToken;
        this.refreshToken = data.refreshToken || null;
        this.connectionStatus = 'connected';
        console.log('Successfully authenticated with Angel One');
        return { success: true };
      }
      
      this.connectionStatus = 'error';
      this.lastError = 'No JWT token received from Angel One';
      return { success: false, error: this.lastError };
    } catch (error) {
      console.error('Angle One authentication failed:', error);
      this.connectionStatus = 'error';
      this.lastError = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: this.lastError };
    }
  }

  async autoLogin(): Promise<{ success: boolean; error?: string }> {
    const clientCode = import.meta.env.VITE_ANGLEONE_CLIENT_CODE;
    const totpSecret = import.meta.env.VITE_ANGLEONE_TOTP_SECRET;

    console.log('Attempting auto-login...');
    console.log('API Key configured:', !!this.apiKey);
    console.log('Client Code:', clientCode ? '✓' : '✗');
    console.log('TOTP Secret:', totpSecret ? '✓' : '✗');

    if (!clientCode || !totpSecret) {
      console.error('Missing required environment variables for Angle One login');
      this.lastError = 'Missing CLIENT_CODE or TOTP_SECRET in environment variables';
      return { success: false, error: this.lastError };
    }

    if (!this.apiKey) {
      console.error('API Key not configured');
      this.lastError = 'API Key not configured';
      return { success: false, error: this.lastError };
    }

    try {
      const totp = generateTOTP(totpSecret);
      console.log('Generated TOTP:', totp ? '✓' : '✗');
      return await this.authenticate(clientCode, totp);
    } catch (error) {
      console.error('Auto login failed:', error);
      this.lastError = error instanceof Error ? error.message : 'TOTP generation failed';
      return { success: false, error: this.lastError };
    }
  }

  async getOptionChain(symbol: string, exchange: 'NSE' | 'BSE' = 'NSE'): Promise<OptionChainData | null> {
    try {
      const nseSymbol = symbol === 'NIFTY' ? 'NIFTY' : 
                        symbol === 'BANKNIFTY' ? 'BANKNIFTY' : 
                        symbol;
      
      // Option chain data doesn't require authentication - use direct API URL
      const response = await fetch(
        `${getBaseUrl()}/hl/optionchain/v1/get?exchange=${exchange}&symboltoken=${nseSymbol}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'X-Api-Key': this.apiKey,
          },
        }
      );

      if (!response.ok) {
        console.error('Option chain fetch error:', response.status, await response.text());
        return null;
      }

      const data = await response.json() as { data: { records: AngelOneOrderBookResponse['data'] } };
      
      if (data.data?.records) {
        return this.transformToOptionChain(data.data.records, symbol);
      }
      return null;
    } catch (error) {
      console.error('Failed to fetch option chain:', error);
      return null;
    }
  }

  private transformToOptionChain(
    records: AngelOneOrderBookResponse['data'],
    symbol: string
  ): OptionChainData {
    const strikesMap = new Map<number, OptionStrike>();
    let underlyingPrice = 0;

    records.forEach(record => {
      if (record.lotSize && !underlyingPrice) {
        underlyingPrice = record.strike;
      }

      const strike: OptionStrike = {
        strike: record.strike,
      };

      if (record.optionType === 'CE') {
        strike.call = this.createOptionData(record);
      } else if (record.optionType === 'PE') {
        strike.put = this.createOptionData(record);
      }

      strikesMap.set(record.strike, {
        ...strikesMap.get(record.strike),
        ...strike,
      });
    });

    const sortedStrikes = Array.from(strikesMap.values()).sort(
      (a, b) => a.strike - b.strike
    );

    const expiry = records[0]?.expiry || new Date().toISOString();
    const expiryDate = new Date(expiry);
    const expiryLabel = expiryDate.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });

    return {
      symbol,
      underlyingPrice,
      expiry,
      expiryLabel,
      strikes: sortedStrikes,
      lastUpdateTime: Date.now(),
    };
  }

  private createOptionData(record: AngelOneOrderBookResponse['data'][0]) {
    return {
      symbol: record.nseSymbol,
      lastPrice: 0,
      change: 0,
      volume: 0,
      openInterest: 0,
      bid: 0,
      ask: 0,
      iv: 0,
      delta: 0,
      gamma: 0,
      theta: 0,
      vega: 0,
    };
  }

  async getOptionQuotes(symbols: string[]): Promise<AngleOneOptionQuote[]> {
    try {
      const tokenResponse = await fetch(
        `${getBaseUrl()}/hl/optionchain/v1/get`,
        {
          method: 'POST',
          headers: this.getAuthHeaders(),
          body: JSON.stringify({
            mode: 'FULL',
            symbols: symbols.map(s => ({
              exchange: 'NSE',
              symbolToken: s,
            })),
          }),
        }
      );

      const data = await tokenResponse.json();
      return this.transformQuotes(data);
    } catch (error) {
      console.error('Failed to fetch option quotes:', error);
      return [];
    }
  }

  private transformQuotes(data: unknown): AngleOneOptionQuote[] {
    const quotes: AngleOneOptionQuote[] = [];
    
    if (data && typeof data === 'object' && 'data' in data) {
      const responseData = (data as { data: AngelOneLTPResponse['data'] }).data;
      if (Array.isArray(responseData)) {
        responseData.forEach(item => {
          quotes.push({
            exchange: (item.exchange as 'NSE' | 'BSE') || 'NSE',
            symbol: item.symbol || '',
            token: item.token,
            lastPrice: item.lastPrice || 0,
            change: item.change || 0,
            changePercent: item.percentChange || 0,
            volume: item.volume || 0,
            openInterest: 0,
            bid: 0,
            ask: 0,
            high: item.high || 0,
            low: item.low || 0,
            iv: 0,
            delta: 0,
            gamma: 0,
            theta: 0,
            vega: 0,
            gammaExpiry: '',
          });
        });
      }
    }
    
    return quotes;
  }

  connectWebSocket(onMessage: (data: unknown) => void): void {
    if (this.ws) {
      this.ws.close();
    }

    this.ws = new WebSocket(ANGLE_ONE_WS_URL);

    this.ws.onopen = () => {
      if (this.accessToken) {
        this.ws?.send(JSON.stringify({
          action: 'authenticate',
          params: {
            token: this.accessToken,
          },
        }));
      }
    };

    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      onMessage(data);
    };

    this.ws.onerror = (error) => {
      console.error('Angle One WebSocket error:', error);
    };

    this.ws.onclose = () => {
      setTimeout(() => {
        this.connectWebSocket(onMessage);
      }, 5000);
    };
  }

  subscribeToOptionChain(symbol: string, callback: (data: OptionChainData) => void): void {
    if (!this.subscribers.has(symbol)) {
      this.subscribers.set(symbol, new Set());
    }
    this.subscribers.get(symbol)?.add(callback);

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        action: 'subscribe',
        params: {
          mode: 'FULL',
          exchange: 'NSE',
          symbolToken: symbol,
        },
      }));
    }
  }

  unsubscribeFromOptionChain(symbol: string, callback: (data: OptionChainData) => void): void {
    this.subscribers.get(symbol)?.delete(callback);
    
    if (this.subscribers.get(symbol)?.size === 0) {
      this.subscribers.delete(symbol);
      
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          action: 'unsubscribe',
          params: {
            exchange: 'NSE',
            symbolToken: symbol,
          },
        }));
      }
    }
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.subscribers.clear();
  }

  isConnected(): boolean {
    return this.connectionStatus === 'connected';
  }

  getConnectionStatus(): string {
    return this.connectionStatus;
  }

  getLastError(): string {
    return this.lastError;
  }

  getAccessToken(): string | null {
    return this.accessToken;
  }
}

export const angleOneService = new AngleOneService();