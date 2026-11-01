/**
 * Numeric formatting helpers for live price / quantity display.
 *
 * These are deliberately simple, locale-independent and deterministic so that
 * tests — and a reader inspecting the file — can reason about the output
 * without depending on the host's locale configuration.
 */

/** Format a price to 2 decimal places. Statically typed, no runtime surprises. */
export function formatPrice(price: number): string {
  if (!Number.isFinite(price)) return "—";
  return price.toFixed(2);
}

/** Format a quantity to 4 decimal places, trimming trailing zeros. */
export function formatQty(qty: number): string {
  if (!Number.isFinite(qty) || qty <= 0) return "—";
  const s = qty.toFixed(4);
  // Trim trailing zeros but keep at least one digit after the decimal point.
  const trimmed = s.replace(/0+$/, "").replace(/\.$/, ".0");
  return trimmed;
}

/**
 * Compact magnitude formatting for dashboard display: 87_478_912_932 → "87.48B",
 * 109_026.76 → "109.03K", 523.4 → "523.40", negatives keep their sign.
 * Deterministic (no locale) so tests are portable.
 */
export function formatCompact(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  const tiers: Array<[number, string]> = [
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ];
  for (const [factor, suffix] of tiers) {
    if (abs >= factor) {
      return `${sign}${trimCompactZeros((abs / factor).toFixed(2))}${suffix}`;
    }
  }
  return `${sign}${trimCompactZeros(abs.toFixed(2))}`;
}

/** Base-asset 24h volume compact display: "109.03K". null/absent → em dash. */
export function formatCompactQty(qty: number | null): string {
  if (qty == null || !Number.isFinite(qty)) return "—";
  return formatCompact(qty);
}

/** Quote-asset (USDT) 24h volume compact display: "$8.74B". */
export function formatCompactUsd(qty: number | null): string {
  if (qty == null || !Number.isFinite(qty)) return "—";
  return `$${formatCompact(qty)}`;
}

/** Signed 24h change percent: -0.42 → "-0.42%", 0.186 → "+0.19%", null → em dash. */
export function formatSignedPercent(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const rounded = Math.abs(value) < 0.005 ? 0 : value;
  const s = rounded.toFixed(2).replace(/\.00$/, ""); // 0.00 stays plain "0"
  return `${rounded > 0 ? "+" : ""}${s}%`;
}

/** "12.00" → "12", "1.20" → "1.2", "1.05" stays "1.05" — never leaves a dangling ".". */
function trimCompactZeros(s: string): string {
  if (!s.includes(".")) return s;
  return s.replace(/0+$/, "").replace(/\.$/, "");
}
