/**
 * Order-flow context of a setup, as measured by the analysis service (`analysis/flow.py`):
 * labels, which buckets an occurrence falls in, and an honest comparison of a bucket's record
 * with the setup's overall record. Display only.
 */
import type { ContextSummaryOut, FlowOut, SummaryOut } from "../api/schema";

export type FlowContextId =
  | "delta:confirms"
  | "delta:against"
  | "delta:neutral"
  | "cvdDiv:yes"
  | "cvdDiv:no";

export const FLOW_CONTEXTS: readonly FlowContextId[] = [
  "delta:confirms",
  "delta:against",
  "delta:neutral",
  "cvdDiv:yes",
  "cvdDiv:no",
];

const LABELS: Record<FlowContextId, string> = {
  "delta:confirms": "Delta with the setup",
  "delta:against": "Delta against the setup",
  "delta:neutral": "Delta neutral",
  "cvdDiv:yes": "CVD divergence",
  "cvdDiv:no": "No CVD divergence",
};

export function contextLabel(id: string): string {
  return id in LABELS ? LABELS[id as FlowContextId] : id;
}

export function isFlowContext(v: unknown): v is FlowContextId {
  return typeof v === "string" && (FLOW_CONTEXTS as readonly string[]).includes(v);
}

/** Buckets this occurrence belongs to (none when flow could not be measured). */
export function contextsOf(flow: FlowOut): FlowContextId[] {
  const out: FlowContextId[] = [];
  if (flow.flow) out.push(`delta:${flow.flow}`);
  if (flow.cvdDivergence !== null) out.push(flow.cvdDivergence ? "cvdDiv:yes" : "cvdDiv:no");
  return out;
}

/** "Delta +3.1% of volume (with the setup)" or a plain "not measurable" line. */
export function flowText(flow: FlowOut): string {
  if (flow.deltaRatio === null || !flow.flow) return "Order flow not measurable (no taker volume)";
  const sign = flow.deltaRatio >= 0 ? "+" : "−";
  const v = `${sign}${(Math.abs(flow.deltaRatio) * 100).toFixed(1)}%`;
  const how =
    flow.flow === "confirms"
      ? "with the setup"
      : flow.flow === "against"
        ? "against it"
        : "neutral";
  return `Delta over 3 candles ${v} of volume (${how})`;
}

export type Comparison = "better" | "worse" | "unclear" | "tooFew";

/**
 * Is this bucket's win rate clearly different from the setup's overall rate? Only when its
 * whole 95% range sits on one side of the overall rate, and with enough cases. Many buckets
 * are compared at once, so even "better" is a lead to test out of sample, not an edge.
 */
export function compare(
  bucket: SummaryOut,
  overallWinRate: number | null,
  minSample: number,
): Comparison {
  if (bucket.n < minSample || overallWinRate === null) return "tooFew";
  if (bucket.ciLow > overallWinRate) return "better";
  if (bucket.ciHigh < overallWinRate) return "worse";
  return "unclear";
}

export function byContext(rows: readonly ContextSummaryOut[]): Map<string, SummaryOut> {
  return new Map(rows.map((r) => [r.context, r.summary]));
}
