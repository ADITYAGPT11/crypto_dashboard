/**
 * Contracts for chart analysis: volume profile, supply/demand zones, pattern
 * detection and setup statistics. Everything is plain data so the same logic
 * can be unit-tested on fixtures and later ported to the Python backend.
 */

export type PatternType = "doubleBottom" | "bullishEngulfing" | "hammer";
export type SetupLocation = "demandZone" | "openSpace";
export type OutcomeResult = "win" | "loss" | "expired" | "open";
export type Verdict = "edge" | "noEdge" | "tooFew";

export interface PricePoint {
  index: number;
  price: number;
}

/** A detected pattern, confirmed on candle `index` (never using later candles). */
export interface PatternHit {
  type: PatternType;
  index: number;
  entry: number;
  stop: number;
  target: number;
  /** Lowest price of the pattern (used to place it relative to zones). */
  low: number;
  /** Key points for drawing (e.g. the two lows and the neckline peak). */
  points: PricePoint[];
  neckline?: number;
}

export interface Zone {
  kind: "demand" | "supply";
  low: number;
  high: number;
  /** Base candle the zone is drawn from. */
  startIndex: number;
  /** Impulse candle that created the zone; the zone exists from here on. */
  formedIndex: number;
  /** Candle that closed through the zone, or null while it is intact. */
  endIndex: number | null;
  tests: number;
  held: number;
}

export interface VolumeProfile {
  low: number;
  high: number;
  binSize: number;
  volumes: number[];
  pocIndex: number;
  pocPrice: number;
  vahPrice: number;
  valPrice: number;
  /** High-volume nodes (prices), strongest first, excluding the POC. */
  hvn: number[];
  /** Low-volume nodes inside the value area (prices), thinnest first. */
  lvn: number[];
}

export interface Outcome {
  result: OutcomeResult;
  exitIndex: number | null;
  /** Percent move from entry to exit (positive on wins, negative on losses). */
  movePct: number;
  /** Result in R: (target − entry) / (entry − stop) on wins, −1 on losses. */
  r: number;
  bars: number;
}

export interface SetupOccurrence {
  symbol: string;
  hit: PatternHit;
  location: SetupLocation;
  outcome: Outcome;
  /** Open time (ms) of the confirmation candle. */
  time: number;
}

export interface SetupStats {
  key: string;
  type: PatternType;
  location: SetupLocation;
  /** Resolved cases (wins + losses). */
  n: number;
  wins: number;
  losses: number;
  expired: number;
  winRate: number;
  /** Wilson 95% interval on the win rate. */
  ci: [number, number];
  /** Win rate needed to break even given the average win and loss sizes. */
  breakEven: number;
  avgWinPct: number;
  avgLossPct: number;
  /** Mean result per resolved case in R, before fees. */
  expectancyR: number;
  medianBars: number;
  verdict: Verdict;
  /** Most recent resolved occurrences, newest first. */
  recent: SetupOccurrence[];
}
