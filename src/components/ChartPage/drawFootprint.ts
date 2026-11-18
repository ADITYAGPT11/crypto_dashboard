import type { Candle } from "../../types/marketData";
import { compactVolume, imbalanceAt, type FootprintBar } from "../../utils/footprint";
import { timeToLogical } from "../../utils/orderFlow";

/** Bars at least this wide (px) with rows this tall show numbers; narrower ones show cells. */
const TEXT_MIN_W = 64;
const TEXT_MIN_H = 11;
/** A lone print needs this share of its bar's volume to count as an imbalance. */
const IMBALANCE_MIN_SHARE = 0.02;

const UP = "86,211,100";
const DOWN = "244,112,103";

/**
 * Footprint bars over the candles: per price row, aggressive sells (left) × buys (right) when
 * zoomed in, coloured cells by row delta when not. Diagonal 3× imbalances are highlighted, the
 * point of control is outlined and the bar's delta is written under it.
 */
export function drawFootprint(
  g: CanvasRenderingContext2D,
  bars: readonly FootprintBar[],
  step: number,
  candles: readonly Candle[],
  intervalMs: number,
  x: (logical: number) => number | null,
  y: (price: number) => number | null,
  h: number,
) {
  g.save();
  g.font = "10px JetBrains Mono, monospace";
  g.textBaseline = "middle";
  for (const bar of bars) {
    const mid = timeToLogical(candles, bar.openTime + intervalMs / 2, intervalMs);
    if (mid === null) continue;
    const i = Math.round(mid);
    const x1 = x(i - 0.45);
    const x2 = x(i + 0.45);
    if (x1 === null || x2 === null || x2 < 0) continue;
    const w = x2 - x1;
    // Row height where this bar trades (log scale makes it vary with price).
    const yA = y((bar.poc + 1) * step);
    const yB = y(bar.poc * step);
    const rowH = yA !== null && yB !== null ? Math.abs(yB - yA) : 0;
    let maxRow = 0;
    for (const r of bar.rows.values()) maxRow = Math.max(maxRow, r.bid + r.ask);
    if (maxRow <= 0) continue;
    const text = w >= TEXT_MIN_W && rowH >= TEXT_MIN_H;
    const minVol = bar.volume * IMBALANCE_MIN_SHARE;
    let bottom = Number.NEGATIVE_INFINITY;
    for (const [r, row] of bar.rows) {
      const yHi = y((r + 1) * step);
      const yLo = y(r * step);
      if (yHi === null || yLo === null || yLo < 0 || yHi > h) continue;
      bottom = Math.max(bottom, yLo);
      const rh = Math.max(1, yLo - yHi);
      const total = row.bid + row.ask;
      const imb = imbalanceAt(bar, r, 3, minVol);
      if (text) {
        g.fillStyle = `rgba(18,24,33,${0.55 + 0.35 * (total / maxRow)})`;
        g.fillRect(x1, yHi, w, rh - 0.5);
        g.fillStyle = imb === "sell" ? `rgb(${DOWN})` : "#9AA7B4";
        g.textAlign = "right";
        g.fillText(compactVolume(row.bid), x1 + w / 2 - 3, yHi + rh / 2);
        g.fillStyle = imb === "buy" ? `rgb(${UP})` : "#9AA7B4";
        g.textAlign = "left";
        g.fillText(compactVolume(row.ask), x1 + w / 2 + 3, yHi + rh / 2);
      } else {
        const d = row.ask - row.bid;
        const a = 0.15 + 0.6 * (Math.abs(d) / maxRow);
        g.fillStyle = `rgba(${d >= 0 ? UP : DOWN},${a.toFixed(3)})`;
        g.fillRect(x1, yHi, w, rh);
        if (imb) {
          g.fillStyle = `rgb(${imb === "buy" ? UP : DOWN})`;
          g.fillRect(imb === "buy" ? x2 - 2 : x1, yHi, 2, rh);
        }
      }
      if (r === bar.poc) {
        g.strokeStyle = "#F0A35E";
        g.lineWidth = 1;
        g.strokeRect(x1 + 0.5, yHi + 0.5, w - 1, rh - 1);
      }
    }
    if (text && Number.isFinite(bottom) && bottom + 12 < h) {
      g.textAlign = "center";
      g.fillStyle = bar.delta >= 0 ? `rgb(${UP})` : `rgb(${DOWN})`;
      g.fillText(
        `Δ ${bar.delta >= 0 ? "+" : ""}${compactVolume(bar.delta)}`,
        x1 + w / 2,
        bottom + 8,
      );
    }
  }
  g.restore();
}
