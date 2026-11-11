/**
 * Chart indicators, TradingView-style: each has inputs (with TradingView's
 * defaults), plots with colours, and a placement (on price, own pane, or the
 * volume strip). Maths comes from `indicatorts` (MIT, pinned); we only align outputs and
 * blank the warm-up so a half-formed average is never drawn. ATR is SMA-seeded Wilder
 * smoothing, so the pane equals the backend ATR behind the pattern stops.
 */
import { atr, bb, ema, macd, obv, psar, rsi, sma, stoch, vwap } from "indicatorts";
import type { Candle } from "../types/marketData";

export type IndicatorId =
  | "volume"
  | "sma"
  | "ema"
  | "bb"
  | "vwap"
  | "psar"
  | "rsi"
  | "macd"
  | "stoch"
  | "atr"
  | "obv";

export interface InputDef {
  key: string;
  label: string;
  default: number;
  min: number;
  max: number;
  step: number;
}

export interface PlotDef {
  key: string;
  label: string;
  color: string;
  kind: "line" | "histogram" | "dots";
}

export interface IndicatorDef {
  id: IndicatorId;
  name: string;
  short: string;
  category: "Trend" | "Volatility" | "Momentum" | "Volume";
  /** overlay = on the price pane; pane = its own pane; volume = bottom strip of the price pane. */
  placement: "overlay" | "pane" | "volume";
  inputs: InputDef[];
  plots: PlotDef[];
  /** Horizontal guide levels (e.g. RSI 70/30). */
  levels?: number[];
  compute: (c: Candle[], p: Record<string, number>) => Record<string, number[]>;
  /** Candles before the first meaningful value. */
  warmup: (p: Record<string, number>) => number;
}

const closes = (c: Candle[]) => c.map((x) => x.close);
const highs = (c: Candle[]) => c.map((x) => x.high);
const lows = (c: Candle[]) => c.map((x) => x.low);
const vols = (c: Candle[]) => c.map((x) => x.volume);

const len = (def = 14, max = 500): InputDef => ({
  key: "length",
  label: "Length",
  default: def,
  min: 1,
  max,
  step: 1,
});

export const INDICATORS: readonly IndicatorDef[] = [
  {
    id: "volume",
    name: "Volume",
    short: "Vol",
    category: "Volume",
    placement: "volume",
    inputs: [],
    plots: [{ key: "volume", label: "Volume", color: "#56D364", kind: "histogram" }],
    compute: (c) => ({ volume: vols(c) }),
    warmup: () => 0,
  },
  {
    id: "sma",
    name: "Moving Average",
    short: "MA",
    category: "Trend",
    placement: "overlay",
    inputs: [len(9)],
    plots: [{ key: "ma", label: "MA", color: "#2962FF", kind: "line" }],
    compute: (c, p) => ({ ma: sma(closes(c), { period: p.length }) }),
    warmup: (p) => p.length - 1,
  },
  {
    id: "ema",
    name: "Moving Average Exponential",
    short: "EMA",
    category: "Trend",
    placement: "overlay",
    inputs: [len(9)],
    plots: [{ key: "ema", label: "EMA", color: "#F0A35E", kind: "line" }],
    compute: (c, p) => ({ ema: ema(closes(c), { period: p.length }) }),
    warmup: (p) => p.length - 1,
  },
  {
    id: "bb",
    name: "Bollinger Bands",
    short: "BB",
    category: "Volatility",
    placement: "overlay",
    inputs: [len(20)],
    plots: [
      { key: "upper", label: "Upper", color: "#F23645", kind: "line" },
      { key: "middle", label: "Basis", color: "#2962FF", kind: "line" },
      { key: "lower", label: "Lower", color: "#089981", kind: "line" },
    ],
    compute: (c, p) => {
      const r = bb(closes(c), { period: p.length });
      return { upper: r.upper, middle: r.middle, lower: r.lower };
    },
    warmup: (p) => p.length - 1,
  },
  {
    id: "vwap",
    name: "Rolling VWAP",
    short: "VWAP",
    category: "Volume",
    placement: "overlay",
    inputs: [len(20)],
    plots: [{ key: "vwap", label: "VWAP", color: "#C084FC", kind: "line" }],
    compute: (c, p) => ({ vwap: vwap(closes(c), vols(c), { period: p.length }) }),
    warmup: (p) => p.length - 1,
  },
  {
    id: "psar",
    name: "Parabolic SAR",
    short: "SAR",
    category: "Trend",
    placement: "overlay",
    inputs: [
      { key: "step", label: "Increment", default: 0.02, min: 0.001, max: 1, step: 0.001 },
      { key: "max", label: "Max value", default: 0.2, min: 0.01, max: 1, step: 0.01 },
    ],
    plots: [{ key: "sar", label: "SAR", color: "#2962FF", kind: "dots" }],
    compute: (c, p) => ({
      sar: psar(highs(c), lows(c), closes(c), { step: p.step, max: p.max }).psarResult,
    }),
    warmup: () => 1,
  },
  {
    id: "rsi",
    name: "Relative Strength Index",
    short: "RSI",
    category: "Momentum",
    placement: "pane",
    inputs: [len(14)],
    plots: [{ key: "rsi", label: "RSI", color: "#7E57C2", kind: "line" }],
    levels: [70, 30],
    compute: (c, p) => ({ rsi: rsi(closes(c), { period: p.length }) }),
    warmup: (p) => p.length,
  },
  {
    id: "macd",
    name: "MACD",
    short: "MACD",
    category: "Momentum",
    placement: "pane",
    inputs: [
      { key: "fast", label: "Fast length", default: 12, min: 1, max: 200, step: 1 },
      { key: "slow", label: "Slow length", default: 26, min: 2, max: 400, step: 1 },
      { key: "signal", label: "Signal smoothing", default: 9, min: 1, max: 100, step: 1 },
    ],
    plots: [
      { key: "hist", label: "Histogram", color: "#26A69A", kind: "histogram" },
      { key: "macd", label: "MACD", color: "#2962FF", kind: "line" },
      { key: "signal", label: "Signal", color: "#FF6D00", kind: "line" },
    ],
    levels: [0],
    compute: (c, p) => {
      const r = macd(closes(c), { fast: p.fast, slow: p.slow, signal: p.signal });
      return {
        macd: r.macdLine,
        signal: r.signalLine,
        hist: r.macdLine.map((m, i) => m - r.signalLine[i]),
      };
    },
    warmup: (p) => p.slow + p.signal - 2,
  },
  {
    id: "stoch",
    name: "Stochastic",
    short: "Stoch",
    category: "Momentum",
    placement: "pane",
    inputs: [
      { key: "k", label: "%K length", default: 14, min: 1, max: 200, step: 1 },
      { key: "d", label: "%D smoothing", default: 3, min: 1, max: 50, step: 1 },
    ],
    plots: [
      { key: "k", label: "%K", color: "#2962FF", kind: "line" },
      { key: "d", label: "%D", color: "#FF6D00", kind: "line" },
    ],
    levels: [80, 20],
    compute: (c, p) => {
      const r = stoch(highs(c), lows(c), closes(c), { kPeriod: p.k, dPeriod: p.d });
      return { k: r.k, d: r.d };
    },
    warmup: (p) => p.k + p.d - 2,
  },
  {
    id: "atr",
    name: "Average True Range",
    short: "ATR",
    category: "Volatility",
    placement: "pane",
    inputs: [len(14)],
    plots: [{ key: "atr", label: "ATR", color: "#B71C1C", kind: "line" }],
    compute: (c, p) => ({
      atr: atr(highs(c), lows(c), closes(c), { period: p.length, seed: "sma" }).atrLine,
    }),
    warmup: (p) => p.length,
  },
  {
    id: "obv",
    name: "On Balance Volume",
    short: "OBV",
    category: "Volume",
    placement: "pane",
    inputs: [],
    plots: [{ key: "obv", label: "OBV", color: "#2962FF", kind: "line" }],
    compute: (c) => ({ obv: obv(closes(c), vols(c)) }),
    warmup: () => 1,
  },
];

export const INDICATOR_BY_ID = new Map(INDICATORS.map((d) => [d.id, d]));

export interface IndicatorInstance {
  uid: string;
  id: IndicatorId;
  params: Record<string, number>;
  colors: Record<string, string>;
  visible: boolean;
}

export function defaultParams(def: IndicatorDef): Record<string, number> {
  return Object.fromEntries(def.inputs.map((i) => [i.key, i.default]));
}

export function newInstance(id: IndicatorId, uid: string): IndicatorInstance {
  const def = INDICATOR_BY_ID.get(id)!;
  return {
    uid,
    id,
    params: defaultParams(def),
    colors: Object.fromEntries(def.plots.map((p) => [p.key, p.color])),
    visible: true,
  };
}

/** Legend title, e.g. "EMA 50" or "MACD 12 26 9". */
export function instanceTitle(inst: IndicatorInstance): string {
  const def = INDICATOR_BY_ID.get(inst.id)!;
  const args = def.inputs.map((i) => inst.params[i.key]).join(" ");
  return args ? `${def.short} ${args}` : def.short;
}

/** Compute every plot, aligned to the candles, NaN during warm-up or where invalid. */
export function computeInstance(
  inst: IndicatorInstance,
  candles: Candle[],
): Record<string, number[]> {
  const def = INDICATOR_BY_ID.get(inst.id)!;
  if (candles.length === 0) return Object.fromEntries(def.plots.map((p) => [p.key, []]));
  const raw = def.compute(candles, inst.params);
  const warm = Math.max(0, def.warmup(inst.params));
  const out: Record<string, number[]> = {};
  for (const p of def.plots) {
    const v = raw[p.key] ?? [];
    out[p.key] = candles.map((_, i) =>
      i < warm || i >= v.length || !Number.isFinite(v[i]) ? Number.NaN : v[i],
    );
  }
  return out;
}

/** Clamp an input to its allowed range (settings dialog and stored values). */
export function clampInput(def: InputDef, value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : def.default;
  return Math.min(def.max, Math.max(def.min, n));
}

export const INDICATORS_STORAGE_KEY = "chart:indicators";
export const DEFAULT_INDICATORS: IndicatorInstance[] = [
  newInstance("volume", "default-volume"),
  { ...newInstance("ema", "default-ema"), params: { length: 50 } },
];

const COLOR = /^#[0-9a-fA-F]{6}$/;

/** Validate stored instances; unknown indicators and bad values are dropped or reset. */
export function parseInstances(value: unknown): IndicatorInstance[] {
  if (!Array.isArray(value)) return DEFAULT_INDICATORS;
  const out: IndicatorInstance[] = [];
  for (const raw of value) {
    const v = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
    const def = INDICATOR_BY_ID.get(v.id as IndicatorId);
    if (!def || typeof v.uid !== "string" || out.some((o) => o.uid === v.uid)) continue;
    const params = (v.params ?? {}) as Record<string, unknown>;
    const colors = (v.colors ?? {}) as Record<string, unknown>;
    out.push({
      uid: v.uid,
      id: def.id,
      params: Object.fromEntries(def.inputs.map((i) => [i.key, clampInput(i, params[i.key])])),
      colors: Object.fromEntries(
        def.plots.map((p) => {
          const c = colors[p.key];
          return [p.key, typeof c === "string" && COLOR.test(c) ? c : p.color];
        }),
      ),
      visible: v.visible !== false,
    });
    if (out.length >= 20) break;
  }
  return out;
}
