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

export interface CaseOut {
  symbol: string;
  location: string;
  time: number;
  result: "win" | "loss" | "expired";
  entry: number;
  stop: number;
  target: number;
  movePct: number;
  r: number;
  bars: number;
  exitTime: number | null;
  deltaRatio?: number | null;
  flow?: "confirms" | "against" | "neutral" | null;
  cvdDivergence?: boolean | null;
  trailResult?: "win" | "loss" | "expired" | "open" | null;
  trailR?: number | null;
  trailBars?: number | null;
  trailExitTime?: number | null;
  costR?: number | null;
  netR?: number | null;
  trailNetR?: number | null;
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

export interface ContextSummaryOut {
  context: string;
  summary: SummaryOut;
}

export interface CostsOut {
  feePct: number;
  slippagePct: number;
  roundTripPct: number;
  fundingUntil: Record<string, number | null>;
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

export interface FlowOut {
  deltaRatio: number | null;
  flow: "confirms" | "against" | "neutral" | null;
  cvdDivergence: boolean | null;
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
  flow: FlowOut;
  trail: TrailOut;
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
  costs?: CostsOut | null;
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
  contexts: ContextSummaryOut[];
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
  context?: string;
  symbol?: string;
  setups: SetupStatOut[];
}

export interface StopOut {
  time: number;
  price: number;
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
  expectancyNetR?: number;
  breakEvenNet?: number;
  avgCostR?: number;
  trail?: TrailSummaryOut | null;
}

export interface TrailOut {
  result: "win" | "loss" | "expired" | "open";
  exitTime: number | null;
  exitPrice: number | null;
  r: number;
  bars: number;
  activatedTime: number | null;
  stops: StopOut[];
}

export interface TrailSummaryOut {
  n: number;
  wins: number;
  winRate: number;
  ciLow: number;
  ciHigh: number;
  expectancyR: number;
  expectancyNetR?: number;
  expLow: number | null;
  expHigh: number | null;
  avgWinR: number;
  avgCostR?: number;
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
