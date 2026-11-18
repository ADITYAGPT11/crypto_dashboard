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
  result: "win" | "loss";
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

export interface ForwardOut {
  ruleset: string;
  htf: string;
  ltf: string;
  entry: "market" | "fib" | "fvg";
  exit: "target" | "trail" | "managed";
  startedAt: number | null;
  lastRun: number | null;
  signals: number;
  coins: string[];
  failed: string[];
  trades: ForwardTradeOut[];
}

export interface ForwardTradeOut {
  symbol: string;
  time: number;
  pattern: string;
  direction: "long" | "short";
  location: string;
  status: "pending" | "skipped" | "cancelled" | "open" | "closed";
  note?: string;
  entryPrice: number | null;
  stop: number | null;
  target: number | null;
  fillTime: number | null;
  exitTime: number | null;
  exitPrice: number | null;
  reason: "stop" | "target" | "trail" | "breakeven" | "time" | null;
  stopNow: number | null;
  rNet: number;
  rGross: number;
  firstSeen: number;
  late: boolean;
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

export interface PaperTradeOut {
  symbol: string;
  pattern: string;
  direction: "long" | "short";
  location: string;
  time: number;
  entryPrice: number;
  stop: number;
  exitPrice: number | null;
  reason: "stop" | "target" | "trail" | "breakeven" | "time" | null;
  rNet: number;
  rGross: number;
  fillTime: number | null;
  exitTime: number | null;
}

export interface PatternOut {
  id: string;
  label: string;
  kind: "chart" | "candlestick";
  bias: "long" | "short" | "either";
  source: string;
  summary: string;
}

export interface PlaybookLiveOut {
  symbol: string;
  htf: string;
  ltf: string;
  ruleset: string;
  coverage: CoverageOut;
  ltfCoverage: CoverageOut;
  triggers: PlaybookTriggerOut[];
}

export interface PlaybookParamsOut {
  triggerBars: number;
  entryBars: number;
  stopAtr: number;
  maxRiskHtfAtr: number;
  minStopPct: number;
  levelTf: string;
  fibLevel: number;
  maxHoldBars: number;
  breakevenR: number;
  partialR: number;
  partialShare: number;
  maker: number;
  taker: number;
  slippage: number;
}

export interface PlaybookStatsOut {
  ruleset: string;
  htf: string;
  ltf: string;
  run: RunOut | null;
  split: number | null;
  params: PlaybookParamsOut;
  variants: PlaybookVariantOut[];
}

export interface PlaybookTradeOut {
  entryKind: "market" | "fib" | "fvg";
  exitKind: "target" | "trail" | "managed";
  status: "pending" | "skipped" | "cancelled" | "open" | "closed";
  note: string;
  entry: number | null;
  stop: number | null;
  target: number | null;
  fillTime: number | null;
  exitTime: number | null;
  exitPrice: number | null;
  reason: "stop" | "target" | "trail" | "breakeven" | "time" | null;
  stopNow: number | null;
  rNet: number;
  rGross?: number;
}

export interface PlaybookTradesOut {
  ruleset: string;
  htf: string;
  ltf: string;
  entry: "market" | "fib" | "fvg";
  exit: "target" | "trail" | "managed";
  run: RunOut | null;
  trades: PaperTradeOut[];
}

export interface PlaybookTriggerOut {
  pattern: string;
  direction: "long" | "short";
  location: "confluence" | "zone" | "orderBlock" | "openSpace";
  time: number;
  knownAt: number;
  windowEnd: number;
  stage: "waiting" | "confirmed" | "expired" | "invalidated";
  htfStop: number;
  htfTarget: number;
  chochTime: number | null;
  broke: number | null;
  impulseLow: number | null;
  impulseHigh: number | null;
  trades: PlaybookTradeOut[];
}

export interface PlaybookVariantOut {
  entry: "market" | "fib" | "fvg";
  exit: "target" | "trail" | "managed";
  all: RSummaryOut | null;
  inSample: RSummaryOut | null;
  outOfSample: RSummaryOut | null;
}

export interface PointOut {
  time: number;
  price: number;
  label: string;
}

export interface RSummaryOut {
  n: number;
  wins: number;
  winRate: number;
  ciLow: number;
  ciHigh: number;
  meanR: number;
  meanRLow: number;
  meanRHigh: number;
  meanGrossR: number;
  avgWinR: number;
  avgLossR: number;
  profitFactor: number;
  medianBars: number;
  baselineN: number;
  baselineMeanR: number;
  edgeVsRandom: number;
  edgeVsRandomLow: number;
  edgeVsRandomHigh: number;
  verdict: "edge" | "noEdge" | "tooFew";
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
