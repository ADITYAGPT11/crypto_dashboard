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
