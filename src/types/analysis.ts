/**
 * Analysis results as the frontend uses them. Detection, locations and the setup checklist
 * are computed by the Python backend (`backend/src/tcs/analysis`); these types wrap the
 * generated API types in `src/api/schema.ts`.
 */
import type {
  CheckOut,
  FvgOut,
  OccurrenceOut,
  OrderBlockOut,
  StructureOut,
  ZoneOut,
} from "../api/schema";

/** A pattern id from the backend's catalogue (`/api/v1/patterns`), e.g. "doubleBottom". */
export type PatternId = string;
export type Direction = OccurrenceOut["direction"];
export type SetupLocation = OccurrenceOut["location"];
/** A location, or "*" for every location together (the pattern's baseline). */
export type LocationFilter = SetupLocation | "*";
/** One item of a setup's checklist (location, RSI, volume, VWAP, ATR, Supertrend). */
export type SetupCheck = CheckOut;

export type Zone = ZoneOut;
export type OrderBlock = OrderBlockOut;
export type FairValueGap = FvgOut;
export type StructureBreak = StructureOut;

/** A detected setup on one coin (times are candle open times, ms). */
export interface SetupOccurrence extends OccurrenceOut {
  symbol: string;
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
