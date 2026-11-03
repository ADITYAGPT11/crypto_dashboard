/**
 * Display helpers for the TradingView-style chart: Heikin-Ashi candles,
 * timeframe labels and groups, and the per-browser chart preferences
 * (favourite timeframes, chart type, price scale mode).
 */
import type { Candle, CandleInterval } from "../types/marketData";
import { CANDLE_INTERVALS } from "../types/marketData";

/**
 * Heikin-Ashi: close = OHLC average; open = midpoint of the previous HA candle
 * (first: midpoint of its own open/close); high/low include the HA open/close.
 * Display only: patterns and statistics always use the real candles.
 */
export function heikinAshi(candles: readonly Candle[]): Candle[] {
  const out: Candle[] = [];
  for (const [i, c] of candles.entries()) {
    const close = (c.open + c.high + c.low + c.close) / 4;
    const open = i === 0 ? (c.open + c.close) / 2 : (out[i - 1].open + out[i - 1].close) / 2;
    out.push({
      ...c,
      open,
      close,
      high: Math.max(c.high, open, close),
      low: Math.min(c.low, open, close),
    });
  }
  return out;
}

/** TradingView-style labels: 1m, 15m, 1h, 4h, D, 3D, W. */
export function tfLabel(tf: CandleInterval): string {
  if (tf === "1d") return "D";
  if (tf === "3d") return "3D";
  if (tf === "1w") return "W";
  return tf;
}

/** Long form for menus: "15 minutes", "4 hours", "1 day", "1 week". */
export function tfLongLabel(tf: CandleInterval): string {
  const n = Number.parseInt(tf, 10);
  const unit = tf.slice(String(n).length);
  const word = { m: "minute", h: "hour", d: "day", w: "week" }[unit] ?? unit;
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export const TF_GROUPS: { label: string; tfs: CandleInterval[] }[] = [
  { label: "Minutes", tfs: ["1m", "3m", "5m", "15m", "30m"] },
  { label: "Hours", tfs: ["1h", "2h", "4h", "6h", "8h", "12h"] },
  { label: "Days", tfs: ["1d", "3d", "1w"] },
];

export type ChartType = "candles" | "hollow" | "heikinAshi" | "bars" | "line" | "area";
export const CHART_TYPES: { id: ChartType; label: string }[] = [
  { id: "candles", label: "Candles" },
  { id: "hollow", label: "Hollow candles" },
  { id: "heikinAshi", label: "Heikin Ashi" },
  { id: "bars", label: "Bars" },
  { id: "line", label: "Line" },
  { id: "area", label: "Area" },
];

export type ScaleMode = "normal" | "log" | "percent";

export interface ChartPrefs {
  favorites: CandleInterval[];
  chartType: ChartType;
  scale: ScaleMode;
}

export const DEFAULT_CHART_PREFS: ChartPrefs = {
  favorites: ["15m", "1h", "4h", "1d"],
  chartType: "candles",
  scale: "normal",
};

export const CHART_PREFS_STORAGE_KEY = "chart:prefs";

export function parseChartPrefs(value: unknown): ChartPrefs {
  const v = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  const favs = Array.isArray(v.favorites)
    ? CANDLE_INTERVALS.filter((tf) => (v.favorites as unknown[]).includes(tf))
    : DEFAULT_CHART_PREFS.favorites;
  return {
    favorites: favs,
    chartType: CHART_TYPES.find((t) => t.id === v.chartType)?.id ?? DEFAULT_CHART_PREFS.chartType,
    scale: (["normal", "log", "percent"] as const).find((m) => m === v.scale) ?? "normal",
  };
}

export function loadJson<T>(key: string, parse: (v: unknown) => T): T {
  try {
    const raw = localStorage.getItem(key);
    return parse(raw ? JSON.parse(raw) : null);
  } catch {
    return parse(null);
  }
}

export function saveJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage blocked: preferences last for this session only
  }
}
