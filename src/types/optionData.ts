// Option data types for Angle One Smart API integration

export interface OptionStrike {
  strike: number;
  call?: OptionData;
  put?: OptionData;
}

export interface OptionData {
  symbol: string;
  lastPrice: number;
  change: number;
  volume: number;
  openInterest: number;
  bid: number;
  ask: number;
  iv: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
}

export interface OptionChainData {
  symbol: string;
  underlyingPrice: number;
  expiry: string;
  expiryLabel: string;
  strikes: OptionStrike[];
  lastUpdateTime: number;
}

export interface AngleOneCredentials {
  apiKey: string;
  clientCode: string;
  password?: string;
}

export interface AngleOneOptionQuote {
  exchange: "NSE" | "BSE";
  symbol: string;
  token: string;
  lastPrice: number;
  change: number;
  changePercent: number;
  volume: number;
  openInterest: number;
  bid: number;
  ask: number;
  high: number;
  low: number;
  iv: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  gammaExpiry: string;
}