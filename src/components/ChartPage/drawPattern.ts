/**
 * Draws the selected pattern the way charting tools do: shaded formation, neckline or
 * trendlines, labelled key points, breakout marker, measured move and a position box.
 * Geometry comes from `utils/patternGeometry.ts`; this file only paints it.
 */
import type { Candle } from "../../types/marketData";
import { formatPrice } from "../../utils/priceUtils";
import { isChartPattern, patternFigure, positionBox, type Pt } from "../../utils/patternGeometry";
import type { ViewPattern } from "../../utils/timeframeMapping";

const UP = "86,211,100";
const DOWN = "244,112,103";
const INK = "#0B0F14";

type XFn = (logical: number) => number | null;
type YFn = (price: number) => number | null;

function pill(
  g: CanvasRenderingContext2D,
  px: number,
  py: number,
  text: string,
  bg: string,
  fg = INK,
  align: "center" | "left" | "right" = "center",
) {
  const tw = g.measureText(text).width + 10;
  const left = align === "center" ? px - tw / 2 : align === "right" ? px - tw : px;
  g.fillStyle = bg;
  g.beginPath();
  g.roundRect(left, py - 9, tw, 18, 4);
  g.fill();
  g.fillStyle = fg;
  g.fillText(text, left + 5, py);
}

function arrowHead(g: CanvasRenderingContext2D, px: number, py: number, up: boolean) {
  const d = up ? 1 : -1;
  g.beginPath();
  g.moveTo(px, py);
  g.lineTo(px - 5, py + 8 * d);
  g.lineTo(px + 5, py + 8 * d);
  g.closePath();
  g.fill();
}

const pct = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}%`;

export function drawPattern(
  g: CanvasRenderingContext2D,
  vp: ViewPattern,
  name: string,
  candles: readonly Candle[],
  x: XFn,
  y: YFn,
  barW: number,
) {
  const long = vp.direction === "long";
  const rgb = long ? UP : DOWN;
  const solid = `rgb(${rgb})`;
  const map = (p: Pt): [number, number] | null => {
    const px = x(p.x);
    const py = y(p.price);
    return px === null || py === null ? null : [px, py];
  };
  const path = (pts: Pt[]) => {
    g.beginPath();
    let started = false;
    for (const p of pts) {
      const m = map(p);
      if (!m) continue;
      if (started) g.lineTo(m[0], m[1]);
      else g.moveTo(m[0], m[1]);
      started = true;
    }
    return started;
  };

  g.save();
  g.lineJoin = "round";
  g.lineCap = "round";

  // 1. Position box (behind the formation): reward green, risk red, over the outcome window.
  const box = positionBox(vp);
  const bx1 = x(box.x1);
  const bx2 = x(box.x2);
  const yE = y(box.entry);
  const yT = y(box.target);
  const yS = y(box.stop);
  if (bx1 !== null && bx2 !== null && yE !== null && yT !== null && yS !== null) {
    const w = Math.max(bx2 - bx1, barW * 3);
    g.fillStyle = `rgba(${UP},0.14)`;
    g.fillRect(bx1, Math.min(yE, yT), w, Math.abs(yT - yE));
    g.fillStyle = `rgba(${DOWN},0.14)`;
    g.fillRect(bx1, Math.min(yE, yS), w, Math.abs(yS - yE));
    g.strokeStyle = "rgba(230,237,243,0.55)";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(bx1, yE);
    g.lineTo(bx1 + w, yE);
    g.stroke();
    g.font = "10px JetBrains Mono, monospace";
    const inside = (yA: number, text: string, color: string) =>
      pill(g, bx1 + w - 4, yA, text, color, INK, "right");
    const towardT = yT < yE ? -1 : 1;
    inside(
      yT - towardT * 10,
      `Target ${formatPrice(box.target)} ${pct(box.targetPct)}`,
      `rgba(${UP},0.9)`,
    );
    inside(
      yS + towardT * 10,
      `Stop ${formatPrice(box.stop)} ${pct(box.stopPct)}`,
      `rgba(${DOWN},0.9)`,
    );
    const res = vp.outcome.result;
    const verdict =
      res === "win" || res === "loss"
        ? `${res.toUpperCase()} ${vp.outcome.r >= 0 ? "+" : "−"}${Math.abs(vp.outcome.r).toFixed(2)}R`
        : res === "expired"
          ? "Expired"
          : "Open";
    const rrText = box.rr > 0 ? `R:R ${box.rr.toFixed(2)}` : "Target behind entry";
    inside(yE + (towardT > 0 ? -11 : 11), `${rrText} · ${verdict}`, "rgba(230,237,243,0.9)");
    // Where it resolved: a dotted path from the entry to the exit, and a dot there.
    const ex = box.exit ? x(box.exit.x) : null;
    const ey = box.exit ? y(box.exit.price) : null;
    if (ex !== null && ey !== null) {
      g.strokeStyle = "rgba(230,237,243,0.7)";
      g.setLineDash([2, 3]);
      g.beginPath();
      g.moveTo(bx1, yE);
      g.lineTo(ex, ey);
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = vp.outcome.result === "win" ? `rgb(${UP})` : `rgb(${DOWN})`;
      g.beginPath();
      g.arc(ex, ey, 4, 0, Math.PI * 2);
      g.fill();
    }
  }

  g.font = "11px JetBrains Mono, monospace";
  if (isChartPattern(vp)) {
    const fig = patternFigure(vp);
    // 2. Formation: shaded, outlined.
    if (fig.fill.length >= 3 && path(fig.fill)) {
      g.closePath();
      g.fillStyle = `rgba(${rgb},0.16)`;
      g.fill();
    }
    for (const s of fig.strokes) {
      if (!path(s.pts)) continue;
      g.lineWidth = s.width;
      g.strokeStyle = s.faint ? `rgba(${rgb},0.45)` : solid;
      g.setLineDash(s.dashed ? [5, 4] : []);
      g.stroke();
    }
    g.setLineDash([]);
    g.fillStyle = solid;
    for (const d of fig.dots) {
      const m = map(d);
      if (!m) continue;
      g.beginPath();
      g.arc(m[0], m[1], 3, 0, Math.PI * 2);
      g.fill();
    }
    // 3. Pattern height inside the formation.
    if (fig.height) {
      const a = map(fig.height.from);
      const b = map(fig.height.to);
      if (a && b) {
        g.strokeStyle = `rgba(${rgb},0.8)`;
        g.lineWidth = 1;
        g.setLineDash([2, 3]);
        g.beginPath();
        g.moveTo(a[0], a[1]);
        g.lineTo(b[0], b[1]);
        g.stroke();
        g.setLineDash([]);
      }
    }
    // 4. Measured move from the breakout to the target.
    if (fig.projection) {
      const a = map(fig.projection.from);
      const b = map(fig.projection.to);
      if (a && b) {
        const px = a[0] + Math.max(barW * 2, 10);
        g.strokeStyle = solid;
        g.lineWidth = 1.5;
        g.setLineDash([4, 3]);
        g.beginPath();
        g.moveTo(px, a[1]);
        g.lineTo(px, b[1]);
        g.stroke();
        g.setLineDash([]);
        g.fillStyle = solid;
        arrowHead(g, px, b[1], b[1] < a[1]);
        g.font = "10px JetBrains Mono, monospace";
        g.fillText(fig.projection.text, px + 6, (a[1] + b[1]) / 2);
        g.font = "11px JetBrains Mono, monospace";
      }
    }
    // 5. Key-point tags.
    for (const l of fig.labels) {
      const m = map(l.at);
      if (m) pill(g, m[0], m[1] + (l.side === "below" ? 14 : -14), l.text, solid);
    }
    // 6. Name tag beyond the formation.
    const sx = x(fig.span.x);
    const sy = y(long ? fig.span.high : fig.span.low);
    if (sx !== null && sy !== null) {
      g.font = "bold 11px JetBrains Mono, monospace";
      pill(g, sx, sy + (long ? -16 : 16), `${long ? "▲" : "▼"} ${name}`, solid, INK, "left");
    }
    // 7. Breakout marker on the confirmation close.
    const bm = map(fig.breakout);
    if (bm) {
      g.fillStyle = INK;
      g.strokeStyle = solid;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(bm[0], bm[1], 4.5, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
  } else {
    // Candlestick patterns: a box around their candles and the name above / below it.
    const first = vp.blocks[0];
    const last = vp.blocks[vp.blocks.length - 1];
    const from = Math.min(first.from, vp.startX);
    const x1 = x(from);
    const x2 = x(last.to);
    const i0 = Math.max(0, Math.round(from + 0.5));
    const i1 = Math.min(candles.length - 1, Math.round(last.to - 0.5));
    const span = candles.slice(i0, i1 + 1);
    const yHigh = span.length ? y(Math.max(...span.map((c) => c.high))) : null;
    const yLow = span.length ? y(Math.min(...span.map((c) => c.low))) : null;
    if (x1 !== null && x2 !== null && yHigh !== null && yLow !== null) {
      const pad = Math.max(0, (barW * 1.4 - (x2 - x1)) / 2);
      g.fillStyle = `rgba(${rgb},0.14)`;
      g.fillRect(x1 - pad, yHigh - 6, x2 - x1 + pad * 2, yLow - yHigh + 12);
      g.strokeStyle = solid;
      g.lineWidth = 1.5;
      g.strokeRect(x1 - pad, yHigh - 6, x2 - x1 + pad * 2, yLow - yHigh + 12);
      g.font = "bold 11px JetBrains Mono, monospace";
      const cx = (x1 + x2) / 2;
      pill(g, cx, long ? yLow + 22 : yHigh - 22, `${long ? "▲" : "▼"} ${name}`, solid);
    }
  }
  g.restore();
}
