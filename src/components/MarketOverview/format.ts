/** Formatting shared by the market-overview panels. */

export function signed(v: number | null | undefined, digits = 1, unit = "%"): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const s = Math.abs(v).toFixed(digits);
  return `${v >= 0 ? "+" : "−"}${s}${unit}`;
}

export function usdCompact(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  if (abs >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

export function tone(v: number | null | undefined): "up" | "down" | "flat" {
  if (v == null || !Number.isFinite(v) || v === 0) return "flat";
  return v > 0 ? "up" : "down";
}

export function clock(ms: number | null): string {
  if (ms == null) return "—";
  return new Date(ms).toISOString().slice(11, 16) + " UTC";
}

export function ago(ms: number | null, now: number): string {
  if (ms == null) return "no data yet";
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
}
