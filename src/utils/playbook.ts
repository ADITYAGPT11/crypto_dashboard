/**
 * The multi-timeframe playbook as the screens describe it: variant labels, which variant to
 * show by default, and plain-language stage and trade lines. Display only; the rules and every
 * number come from the analysis service (`analysis/playbook.py`).
 */
import type {
  PlaybookStatsOut,
  PlaybookTradeOut,
  PlaybookTriggerOut,
  PlaybookVariantOut,
  RSummaryOut,
} from "../api/schema";
import { price } from "./format";

export type EntryKind = PlaybookVariantOut["entry"];
export type ExitKind = PlaybookVariantOut["exit"];
export type VariantKey = `${EntryKind}|${ExitKind}`;

export const ENTRY_LABEL: Record<EntryKind, string> = {
  market: "At the CHoCH close",
  fib: "Limit at 0.618 Fib",
  fvg: "Limit at the FVG",
};

export const EXIT_LABEL: Record<ExitKind, string> = {
  target: "Pattern target",
  trail: "Trail under higher lows",
  managed: "Breakeven 1R, half at 2R, trail",
};

export const variantKey = (entry: EntryKind, exit: ExitKind): VariantKey => `${entry}|${exit}`;

export function variantLabel(entry: EntryKind, exit: ExitKind): string {
  return `${ENTRY_LABEL[entry]} · ${EXIT_LABEL[exit]}`;
}

/** The owner's default plan: Fib entry, managed exit. */
export const DEFAULT_VARIANT: VariantKey = "fib|managed";

/**
 * The variant to show first: the best measured mean R (after costs) among those with enough
 * trades, else the default plan. A pick, not a promise: many variants are compared.
 */
export function bestVariant(stats: PlaybookStatsOut | null, minTrades = 30): VariantKey {
  let best: { key: VariantKey; r: number } | null = null;
  for (const v of stats?.variants ?? []) {
    const s = v.all;
    if (!s || s.n < minTrades) continue;
    if (!best || s.meanR > best.r) best = { key: variantKey(v.entry, v.exit), r: s.meanR };
  }
  return best?.key ?? DEFAULT_VARIANT;
}

export function findVariant(
  stats: PlaybookStatsOut | null,
  key: VariantKey,
): PlaybookVariantOut | null {
  return stats?.variants.find((v) => variantKey(v.entry, v.exit) === key) ?? null;
}

export function signedR(r: number, digits = 2): string {
  const v = Math.abs(r) < 0.005 ? 0 : r;
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(digits)}R`;
}

/** "+0.21R (0.05 to 0.37)". */
export function rWithRange(s: Pick<RSummaryOut, "meanR" | "meanRLow" | "meanRHigh">): string {
  return `${signedR(s.meanR)} (${signedR(s.meanRLow)} to ${signedR(s.meanRHigh)})`;
}

const hhmm = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** Where a trigger stands, in a few words. */
export function stageText(t: PlaybookTriggerOut, ltf: string): string {
  switch (t.stage) {
    case "waiting":
      return `Waiting for a ${ltf} change of character until ${hhmm(t.windowEnd)}`;
    case "confirmed":
      return `${ltf} change of character at ${t.chochTime ? hhmm(t.chochTime) : "—"} (broke ${t.broke !== null ? price(t.broke) : "—"})`;
    case "expired":
      return `No ${ltf} change of character in time: no trade`;
    case "invalidated":
      return "Price closed beyond the setup's stop: no trade";
  }
}

/** What the chosen variant of a confirmed trigger is doing. */
export function tradeText(tr: PlaybookTradeOut): string {
  const plan = tr.entry !== null && tr.stop !== null;
  switch (tr.status) {
    case "skipped":
      return `Skipped: ${tr.note}`;
    case "cancelled":
      return `Cancelled: ${tr.note}`;
    case "pending":
      return plan
        ? `Limit at ${price(tr.entry!)}, stop ${price(tr.stop!)}: waiting for the pullback`
        : "Waiting for the pullback";
    case "open":
      return `In the trade from ${price(tr.entry ?? 0)}; stop now ${price(tr.stopNow ?? tr.stop ?? 0)}`;
    case "closed": {
      const how =
        tr.reason === "target"
          ? "target"
          : tr.reason === "breakeven"
            ? "breakeven stop"
            : tr.reason === "trail"
              ? "trailing stop"
              : tr.reason === "time"
                ? "time limit"
                : "stop";
      return `Closed at ${tr.exitPrice !== null ? price(tr.exitPrice) : "—"} (${how}): ${signedR(tr.rNet)} after costs`;
    }
  }
}
