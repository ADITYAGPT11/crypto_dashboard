/**
 * Analysis results as the frontend uses them. Detection, locations, outcomes and
 * statistics are computed by the Python backend (`backend/src/tcs/analysis`), the
 * one rule set behind both the chart and the background statistics; these types
 * wrap the generated API types in `src/api/schema.ts`.
 */
import type {
  CaseOut,
  FvgOut,
  OccurrenceOut,
  OrderBlockOut,
  StructureOut,
  SummaryOut,
  ZoneOut,
} from "../api/schema";

/** A pattern id from the backend's catalogue (`/api/v1/patterns`), e.g. "doubleBottom". */
export type PatternId = string;
export type Direction = OccurrenceOut["direction"];
export type SetupLocation = OccurrenceOut["location"];
/** A location, or "*" for every location together (the pattern's baseline). */
export type LocationFilter = SetupLocation | "*";
export type OutcomeResult = OccurrenceOut["outcome"]["result"];
export type Verdict = SummaryOut["verdict"];

export type Zone = ZoneOut;
export type OrderBlock = OrderBlockOut;
export type FairValueGap = FvgOut;
export type StructureBreak = StructureOut;
export type SetupCase = CaseOut;

/** A detected setup on one coin (times are candle open times, ms). */
export interface SetupOccurrence extends OccurrenceOut {
  symbol: string;
}

/** Statistics of one setup (pattern × direction × location), pooled or for one coin. */
export interface SetupStats {
  key: string;
  pattern: PatternId;
  direction: Direction;
  location: LocationFilter;
  n: number;
  wins: number;
  losses: number;
  expired: number;
  winRate: number;
  /** Wilson 95% interval on the win rate. */
  ci: [number, number];
  /** Win rate needed to break even given the average win size. */
  breakEven: number;
  avgWinPct: number;
  avgLossPct: number;
  /** Mean result per resolved case in R, before fees. */
  expectancyR: number;
  medianBars: number;
  verdict: Verdict;
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
