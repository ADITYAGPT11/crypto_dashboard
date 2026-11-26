/**
 * GENERATED from the backend's OpenAPI schemas by `npm run api:types`. Do not edit.
 * Source: backend/src/tcs/api/schemas.py
 */

export interface AnalysisOut {
  symbol: string;
  tf: string;
  zoneTf: string;
  ruleset: string;
  coverage: CoverageOut;
  zoneCoverage: CoverageOut;
  occurrences: OccurrenceOut[];
  zones: ZoneOut[];
  orderBlocks: OrderBlockOut[];
  fvgs: FvgOut[];
  structure: StructureOut[];
}

export interface CandlesOut {
  symbol: string;
  tf: string;
  candles: [number, number, number, number, number, number, number | null][];
  coverage: CoverageOut;
}

export interface CatalogOut {
  ruleset: string;
  patterns: PatternOut[];
  maxScore: number;
  timeframes: string[];
  universe: string[];
}

export interface CheckOut {
  id: "location" | "rsi" | "volume" | "vwap" | "atr" | "supertrend";
  label: string;
  passed: boolean;
  detail: string;
}

export interface CoverageOut {
  first: number | null;
  last: number | null;
  count: number;
  expectedLast: number;
  behind: number;
  gaps: number;
  restOk: boolean;
}

export interface DepthColumnOut {
  time: number;
  bucket: number;
  mid: number;
  samples: number;
  bids: [number, number][];
  asks: [number, number][];
}

export interface DepthFeedOut {
  state: "connecting" | "live" | "down";
  error: string | null;
  levels: number;
  since: number | null;
}

export interface DepthOut {
  symbol: string;
  recording: boolean;
  symbols: string[];
  retentionDays: number;
  feeds: Record<string, DepthFeedOut>;
  columns: DepthColumnOut[];
}

export interface FvgOut {
  kind: "bullish" | "bearish";
  low: number;
  high: number;
  time: number;
  formedTime: number;
  filledTime: number | null;
}

export interface HealthOut {
  ok: boolean;
  ruleset: string;
}

export interface LineOut {
  a: PointOut;
  b: PointOut;
  label: string;
}

export interface OccurrenceOut {
  pattern: string;
  direction: "long" | "short";
  location: "confluence" | "zone" | "orderBlock" | "openSpace";
  time: number;
  startTime: number;
  close: number;
  extreme: number;
  points: PointOut[];
  lines: LineOut[];
  score: number;
  checks: CheckOut[];
  formationVolume?: "falling" | "rising" | null;
}

export interface OrderBlockOut {
  kind: "bullish" | "bearish";
  low: number;
  high: number;
  time: number;
  formedTime: number;
  endTime: number | null;
  mitigatedTime: number | null;
  broke: number;
}

export interface PatternOut {
  id: string;
  label: string;
  kind: "chart" | "candlestick";
  bias: "long" | "short" | "either";
  source: string;
  summary: string;
}

export interface PointOut {
  time: number;
  price: number;
  label: string;
}

export interface ScannerItemOut {
  symbol: string;
  occurrence: OccurrenceOut;
}

export interface ScannerOut {
  ruleset: string;
  tf: string;
  zoneTf: string;
  bars: number;
  items: ScannerItemOut[];
  failed: string[];
}

export interface StructureOut {
  kind: "bos" | "choch";
  direction: "up" | "down";
  level: number;
  swingTime: number;
  time: number;
}

export interface ZoneOut {
  kind: "demand" | "supply";
  low: number;
  high: number;
  startTime: number;
  formedTime: number;
  endTime: number | null;
  tests: number;
  held: number;
  departureAtr: number;
}
