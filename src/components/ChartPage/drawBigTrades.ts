import type { Candle, CandleInterval } from "../../types/marketData";
import { bubbleRadius, timeToLogical, type BigTrade } from "../../utils/orderFlow";
import { formatCompactUsd } from "../../utils/priceUtils";
import { TF_MS } from "../../utils/timeframeMapping";

/** Prints this many times the threshold can get a size label… */
const LABEL_AT = 3;
/** …but only the largest few, so a busy bar stays readable. */
const MAX_LABELS = 5;

/** Big taker orders as bubbles at their time and price: green bought, red sold. */
export function drawBigTrades(
  g: CanvasRenderingContext2D,
  prints: readonly BigTrade[],
  threshold: number | null,
  candles: readonly Candle[],
  viewTf: CandleInterval,
  x: (logical: number) => number | null,
  y: (price: number) => number | null,
) {
  if (!threshold || prints.length === 0) return;
  const ms = TF_MS[viewTf];
  const labelled = new Set(
    prints
      .filter((p) => p.notional >= threshold * LABEL_AT)
      .sort((a, b) => b.notional - a.notional)
      .slice(0, MAX_LABELS),
  );
  const taken: { x1: number; x2: number; y1: number; y2: number }[] = [];
  g.save();
  g.textAlign = "center";
  for (const p of prints) {
    const l = timeToLogical(candles, p.time, ms);
    if (l === null) continue;
    const cx = x(l);
    const cy = y(p.price);
    if (cx === null || cy === null) continue;
    const r = bubbleRadius(p.notional, threshold);
    const buy = p.side === "buy";
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fillStyle = buy ? "rgba(86,211,100,0.28)" : "rgba(244,112,103,0.28)";
    g.fill();
    g.lineWidth = 1;
    g.strokeStyle = buy ? "rgba(86,211,100,0.9)" : "rgba(244,112,103,0.9)";
    g.stroke();
    if (labelled.has(p)) {
      const text = formatCompactUsd(p.notional);
      const half = g.measureText(text).width / 2 + 2;
      const box = { x1: cx - half, x2: cx + half, y1: cy - r - 14, y2: cy - r };
      const clash = taken.some(
        (b) => b.x1 < box.x2 && box.x1 < b.x2 && b.y1 < box.y2 && box.y1 < b.y2,
      );
      if (!clash) {
        taken.push(box);
        g.fillStyle = "#E6EDF3";
        g.fillText(text, cx, cy - r - 7);
      }
    }
  }
  g.restore();
}
