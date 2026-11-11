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
  candles: [number, number, number, number, number, number][];
  coverage: CoverageOut;
}

export interface CaseOut {
  symbol: string;
  location: string;
  time: number;
  result: "win" | "loss";
  entry: number;
  stop: number;
  target: number;
  movePct: number;
  r: number;
  bars: number;
  exitTime: number | null;
}

export interface CatalogOut {
  ruleset: string;
  patterns: PatternOut[];
  maxHoldBars: number;
  minSample: number;
  timeframes: string[];
  universe: string[];
}

export interface CoinSummaryOut {
  symbol: string;
  summary: SummaryOut;
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
  runs: Record<string, RunOut | null>;
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
  entry: number;
  stop: number;
  target: number;
  extreme: number;
  points: PointOut[];
  lines: LineOut[];
  outcome: OutcomeOut;
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

export interface OutcomeOut {
  result: "win" | "loss" | "expired" | "open";
  exitTime: number | null;
  movePct: number;
  r: number;
  bars: number;
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

export interface RunOut {
  status: "running" | "done" | "failed";
  startedAt: number;
  finishedAt: number | null;
  coins: string[];
  done: number;
  failed: string[];
  since: number;
  until: number | null;
  candles: number;
  days: number;
}

export interface ScannerItemOut {
  symbol: string;
  occurrence: OccurrenceOut;
  pooled: SummaryOut | null;
  own: SummaryOut | null;
}

export interface ScannerOut {
  ruleset: string;
  tf: string;
  zoneTf: string;
  bars: number;
  items: ScannerItemOut[];
  failed: string[];
  run: RunOut | null;
}

export interface SetupDetailOut {
  ruleset: string;
  tf: string;
  zoneTf: string;
  pattern: string;
  direction: "long" | "short";
  location: string;
  pooled: SummaryOut | null;
  perCoin: CoinSummaryOut[];
  recent: CaseOut[];
}

export interface SetupStatOut {
  pattern: string;
  direction: "long" | "short";
  location: string;
  summary: SummaryOut;
}

export interface StatsOut {
  ruleset: string;
  tf: string;
  zoneTf: string;
  run: RunOut | null;
  setups: SetupStatOut[];
}

export interface StructureOut {
  kind: "bos" | "choch";
  direction: "up" | "down";
  level: number;
  swingTime: number;
  time: number;
}

export interface SummaryOut {
  n: number;
  wins: number;
  losses: number;
  expired: number;
  open?: number;
  winRate: number;
  ciLow: number;
  ciHigh: number;
  breakEven: number;
  avgWinPct: number;
  avgLossPct: number;
  expectancyR: number;
  medianBars: number;
  verdict: "edge" | "noEdge" | "tooFew";
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
