/** Display formatting shared by the analysis screens. */

export function pct(value: number, digits = 0): string {
  return `${(value * 100).toFixed(digits)}%`;
}

export function signedPct(value: number, digits = 1): string {
  const s = value.toFixed(digits);
  return value > 0 ? `+${s}%` : `${s.replace("-", "−")}%`;
}

export function signedR(value: number): string {
  const s = value.toFixed(2);
  return value > 0 ? `+${s}R` : `${s.replace("-", "−")}R`;
}

/** Price with sensible precision for its magnitude. */
export function price(value: number): string {
  const abs = Math.abs(value);
  const digits = abs >= 1000 ? 0 : abs >= 10 ? 2 : abs >= 1 ? 3 : 5;
  return value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function shortDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Compact UTC date ("Nov 22"), with the time ("Nov 22 14:15") when `withTime`. */
export function monthDay(ms: number, withTime = false): string {
  const d = new Date(ms);
  const day = `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  if (!withTime) return day;
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${day} ${hh}:${mm}`;
}
